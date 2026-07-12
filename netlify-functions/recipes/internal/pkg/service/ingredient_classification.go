package service

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// IngredientClassification is the LLM's proposed defaults for a newly
// created ingredient: which unit its shopping-list quantity should be
// normalized to, and (for ingredients normally counted as discrete items,
// e.g. "tomato" or "egg") the average weight in grams of one item.
type IngredientClassification struct {
	PreferredUnit      string
	AverageWeightGrams float64 // 0 = not applicable / unknown
}

type openAIChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIChatRequest struct {
	Model          string              `json:"model"`
	Messages       []openAIChatMessage `json:"messages"`
	ResponseFormat map[string]string   `json:"response_format,omitempty"`
	Temperature    float64             `json:"temperature"`
}

type openAIChatResponse struct {
	Choices []struct {
		Message openAIChatMessage `json:"message"`
	} `json:"choices"`
}

type classificationResponse struct {
	PreferredUnit      string   `json:"preferredUnit"`
	AverageWeightGrams *float64 `json:"averageWeightGrams"`
}

var classificationHTTPClient = &http.Client{Timeout: 15 * time.Second}

// ClassifyIngredient asks an LLM to propose a preferred unit and (where
// applicable) an average item weight for a newly created ingredient, from
// the fixed set of units already in the database.
func ClassifyIngredient(name string, units []Unit) (*IngredientClassification, error) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("OPENAI_API_KEY not set")
	}

	unitDescriptions := make([]string, 0, len(units))
	for _, u := range units {
		if u.Name == "" {
			continue
		}
		unitDescriptions = append(unitDescriptions, fmt.Sprintf("%s (%s)", u.Name, u.Type))
	}

	systemPrompt := "You classify recipe ingredients for a shopping-list app. Respond with strict JSON only, no other text or markdown: " +
		`{"preferredUnit": "<one of the allowed units, exactly as given, or empty string if none fit>", "averageWeightGrams": <number, the average weight in grams of one typical item, only if this ingredient is normally counted in whole/discrete items (e.g. one tomato, one egg, one onion); otherwise null>}`
	userPrompt := fmt.Sprintf("Ingredient: %s\nAllowed units: %s", name, strings.Join(unitDescriptions, ", "))

	payload, err := json.Marshal(openAIChatRequest{
		Model: "gpt-3.5-turbo",
		Messages: []openAIChatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		ResponseFormat: map[string]string{"type": "json_object"},
		Temperature:    0,
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(http.MethodPost, "https://api.openai.com/v1/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := classificationHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return nil, fmt.Errorf("openai request failed with status %d: %s", resp.StatusCode, body)
	}

	var chatResp openAIChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return nil, err
	}
	if len(chatResp.Choices) == 0 {
		return nil, fmt.Errorf("openai returned no choices")
	}

	return parseClassificationContent(chatResp.Choices[0].Message.Content)
}

// parseClassificationContent parses the JSON content of the LLM's chat
// message into an IngredientClassification. Split out from ClassifyIngredient
// so it's testable without a network call.
func parseClassificationContent(content string) (*IngredientClassification, error) {
	var parsed classificationResponse
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return nil, fmt.Errorf("cannot parse openai response %q: %w", content, err)
	}

	classification := &IngredientClassification{PreferredUnit: parsed.PreferredUnit}
	if parsed.AverageWeightGrams != nil {
		classification.AverageWeightGrams = *parsed.AverageWeightGrams
	}
	return classification, nil
}

func isKnownUnit(name string, units []Unit) bool {
	for _, u := range units {
		if u.Name == name {
			return true
		}
	}
	return false
}

// ApplyIngredientClassification stores a proposed classification against an
// ingredient. Only fields the classification actually proposed a value for
// are written, so this never clobbers an existing value with an unset one.
func ApplyIngredientClassification(name string, classification *IngredientClassification, db *sql.DB) error {
	sets := []string{}
	args := []interface{}{}

	if classification.PreferredUnit != "" {
		sets = append(sets, "preferred_unit_id = (SELECT id FROM unit WHERE name = ?)")
		args = append(args, classification.PreferredUnit)
	}
	if classification.AverageWeightGrams > 0 {
		sets = append(sets, "average_weight_grams = ?")
		args = append(args, classification.AverageWeightGrams)
	}
	if len(sets) == 0 {
		return nil
	}

	query := fmt.Sprintf("UPDATE ingredient SET %s WHERE name = ?", strings.Join(sets, ", "))
	args = append(args, name)
	_, err := db.Exec(query, args...)
	return err
}

// ClassifyNewIngredients proposes and stores preferred_unit/average_weight
// defaults for the given ingredient names. It's best-effort: a
// classification failure for one ingredient is logged and skipped rather
// than propagated, so a slow or unavailable LLM never blocks saving a
// recipe. Used both when a recipe introduces a brand new ingredient, and by
// the `backfill-ingredients` one-off command for pre-existing ones.
func ClassifyNewIngredients(names []string, db *sql.DB) {
	if len(names) == 0 {
		return
	}

	units, err := GetAllUnits(db)
	if err != nil {
		log.Printf("could not load units for ingredient classification: %v", err)
		return
	}

	for _, name := range names {
		classification, err := ClassifyIngredient(name, units)
		if err != nil {
			log.Printf("could not classify new ingredient %q: %v", name, err)
			continue
		}
		if classification.PreferredUnit != "" && !isKnownUnit(classification.PreferredUnit, units) {
			log.Printf("ignoring unknown unit %q proposed for ingredient %q", classification.PreferredUnit, name)
			classification.PreferredUnit = ""
		}
		if err := ApplyIngredientClassification(name, classification, db); err != nil {
			log.Printf("could not store classification for ingredient %q: %v", name, err)
		}
	}
}

// NewIngredientNames returns which of the given ingredient names don't
// already exist in the ingredient table.
func NewIngredientNames(names []string, db *sql.DB) ([]string, error) {
	if len(names) == 0 {
		return nil, nil
	}

	placeholders := make([]string, len(names))
	args := make([]interface{}, len(names))
	for i, name := range names {
		placeholders[i] = "?"
		args[i] = name
	}

	query := fmt.Sprintf("SELECT name FROM ingredient WHERE name IN (%s)", strings.Join(placeholders, ","))
	results, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer results.Close()

	existing := make(map[string]bool)
	for results.Next() {
		var name string
		if err := results.Scan(&name); err != nil {
			return nil, err
		}
		existing[name] = true
	}

	newNames := make([]string, 0)
	for _, name := range names {
		if !existing[name] {
			newNames = append(newNames, name)
		}
	}
	return newNames, nil
}

// BackfillIngredientClassifications runs the same LLM classification used
// for newly created ingredients against every existing ingredient that
// doesn't have a preferred_unit_id yet. Intended as a one-off:
// `go run . backfill-ingredients`.
func BackfillIngredientClassifications(db *sql.DB) error {
	results, err := db.Query("SELECT name FROM ingredient WHERE preferred_unit_id IS NULL")
	if err != nil {
		return err
	}
	defer results.Close()

	names := make([]string, 0)
	for results.Next() {
		var name string
		if err := results.Scan(&name); err != nil {
			return err
		}
		names = append(names, name)
	}

	log.Printf("backfilling classification for %d ingredients", len(names))
	ClassifyNewIngredients(names, db)
	return nil
}
