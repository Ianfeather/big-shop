// Package jev asks TypeSafe's Jev model whether Recipes are relevant to a
// search, for Similar Recipes (specs/recipe-search-similar-recipes.md).
//
// Jev answers typed questions about a piece of state rather than generating
// text: here, one yes/no question (a "Noul") per Recipe name, all in one
// request, each answered with a probability. The HTTP API is a single JSON
// POST, so there is no SDK - and no Go one to have.
//
// Two properties shape it, both requirements rather than niceties:
//
//   - **It must do nothing when unconfigured.** Local development, e2e and CI
//     have no TYPESAFE_API_KEY. An unconfigured Client is a no-op, not an
//     error, and Similar Recipes is simply absent - the same arrangement as
//     internal/pkg/purge.
//
//   - **Its answer is never worth waiting long for.** Similar Recipes is
//     additive: the Exact Matches have long since rendered. So every call is
//     bounded by requestTimeout, after which the answer would arrive too late
//     to be useful anyway.
package jev

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"
)

// endpoint is TypeSafe's one inference endpoint.
const endpoint = "https://api.typesafe.ai/v1/systemone"

// Model is the model every request names. "latest" rather than a pinned
// version because TypeSafe publishes nothing else to pin to; the response says
// which version actually answered, and Relevance returns it for telemetry.
const Model = "jev-latest"

// requestTimeout bounds one call. See the package comment for why it is short.
const requestTimeout = 3 * time.Second

// The question, asked once per candidate. It is about relevance to a search,
// not membership of a category: "is Coq au Vin a chicken?" is no, but someone
// searching "chicken" wants it, and "is this an italian?" is not a question at
// all. The decision is recorded in the spec (decision 4); the wording was
// tuned in its Phase 0 against real Recipe names.
const (
	instructions  = "A cook searched their own recipe collection for `query`. Is `recipes[%d]` a recipe they would want that search to find?"
	criteriaTrue  = "The dish is an instance of what was searched for: a kind of that dish, a cuisine or style it belongs to, or a dish plainly built around that ingredient."
	criteriaFalse = "The dish only shares a word, a loose association, or a minor ingredient with the search, or is unrelated."
)

// Client calls Jev. The zero value is not usable; call New.
type Client struct {
	key    string
	client *http.Client
	// endpoint is a field rather than the constant only so a test can point it
	// at an httptest.Server. Nothing in production sets it.
	endpoint string
}

// New returns a Client configured from TYPESAFE_API_KEY. With it unset the
// Client is a no-op - see Configured.
func New() *Client {
	return &Client{
		key:      os.Getenv("TYPESAFE_API_KEY"),
		client:   &http.Client{Timeout: requestTimeout},
		endpoint: endpoint,
	}
}

// Configured reports whether this Client will actually call Jev. For the
// startup log line: "disabled" is right locally and a misconfiguration on Fly,
// and nothing else tells the two apart.
func (c *Client) Configured() bool {
	return c != nil && c.key != ""
}

// Usage is what one call cost, as Jev reports it.
type Usage struct {
	InputTokens  int64 `json:"input_tokens"`
	OutputTokens int64 `json:"output_tokens"`
}

// StatusError is a non-2xx answer from Jev. Kept distinct so telemetry can
// tell a rate limit (429/529 - Jev's own "back off") from our request being
// wrong (4xx) from Jev being down (5xx).
type StatusError struct {
	Status int
	Body   string
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("jev answered %d: %s", e.Status, e.Body)
}

type noul struct {
	Type         string            `json:"type"`
	Instructions string            `json:"instructions"`
	Criteria     map[string]string `json:"criteria"`
}

type request struct {
	Model string `json:"model"`
	State struct {
		Query   string   `json:"query"`
		Recipes []string `json:"recipes"`
	} `json:"state"`
	Questions map[string]noul `json:"questions"`
}

type response struct {
	Model   string `json:"model"`
	Answers map[string]struct {
		Noul *float64 `json:"noul"`
	} `json:"answers"`
	Usage Usage `json:"usage"`
}

// Relevance returns, for each of names in order, the probability that someone
// searching for query would want that Recipe. model is the version that
// answered.
//
// One request carries every name. Question IDs are "r<index>": they are for
// this code only and never reach the model, which is why the full meaning -
// including which name - is in each question's instructions.
//
// Calling it on an unconfigured Client is a programming error, not a quiet
// no-op, so the caller's decision to skip the call stays visible where it is
// made.
func (c *Client) Relevance(ctx context.Context, query string, names []string) (probabilities []float64, model string, usage Usage, err error) {
	if !c.Configured() {
		return nil, "", Usage{}, fmt.Errorf("jev: Relevance called on an unconfigured client")
	}

	var body request
	body.Model = Model
	body.State.Query = query
	body.State.Recipes = names
	body.Questions = make(map[string]noul, len(names))
	for i := range names {
		body.Questions[questionID(i)] = noul{
			Type:         "noul",
			Instructions: fmt.Sprintf(instructions, i),
			Criteria:     map[string]string{"true": criteriaTrue, "false": criteriaFalse},
		}
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return nil, "", Usage{}, fmt.Errorf("jev: encoding request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, "", Usage{}, fmt.Errorf("jev: building request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.key)
	req.Header.Set("Content-Type", "application/json")

	res, err := c.client.Do(req)
	if err != nil {
		return nil, "", Usage{}, fmt.Errorf("jev: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode > 299 {
		// Bounded: this is for a log line and a span, and an error page is not.
		snippet, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return nil, "", Usage{}, &StatusError{Status: res.StatusCode, Body: string(snippet)}
	}

	var decoded response
	if err := json.NewDecoder(res.Body).Decode(&decoded); err != nil {
		return nil, "", Usage{}, fmt.Errorf("jev: decoding response: %w", err)
	}

	probabilities = make([]float64, len(names))
	for i := range names {
		answer, ok := decoded.Answers[questionID(i)]
		if !ok || answer.Noul == nil {
			// A 2xx without every answer is Jev breaking its contract, not a
			// "no". Treating a missing answer as 0 would hide exactly that.
			return nil, "", Usage{}, fmt.Errorf("jev: response has no answer for %s", questionID(i))
		}
		probabilities[i] = *answer.Noul
	}

	return probabilities, decoded.Model, decoded.Usage, nil
}

func questionID(i int) string {
	return "r" + strconv.Itoa(i)
}
