package service

import (
	"database/sql"
	"errors"
	"strings"
	"testing"

	"recipes/internal/pkg/common"
)

// fakeExecer records every query it's asked to run, and can be configured to fail once a
// query contains a given substring - enough to test that insertIngredients/insertUnits/
// insertParts/insertTags build the right statements and correctly propagate a failure,
// without needing a real database.
type fakeExecer struct {
	queries []string
	failOn  string
}

func (f *fakeExecer) Exec(query string, args ...interface{}) (sql.Result, error) {
	f.queries = append(f.queries, query)
	if f.failOn != "" && strings.Contains(query, f.failOn) {
		return nil, errors.New("fake exec failure")
	}
	return fakeResult{}, nil
}

type fakeResult struct{}

func (fakeResult) LastInsertId() (int64, error) { return 1, nil }
func (fakeResult) RowsAffected() (int64, error) { return 1, nil }

func TestInsertIngredients(t *testing.T) {
	recipe := common.Recipe{Ingredients: []common.Ingredient{
		{Name: "flour", Quantity: "200", Unit: "gram"},
		{Name: "egg", Quantity: "2", Unit: ""},
	}}

	t.Run("no ingredients issues no query", func(t *testing.T) {
		fake := &fakeExecer{}
		if err := insertIngredients(common.Recipe{}, fake); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(fake.queries) != 0 {
			t.Fatalf("expected no queries, got %d", len(fake.queries))
		}
	})

	t.Run("batches every ingredient into one upsert", func(t *testing.T) {
		fake := &fakeExecer{}
		if err := insertIngredients(recipe, fake); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(fake.queries) != 1 {
			t.Fatalf("expected 1 query, got %d", len(fake.queries))
		}
		if !strings.Contains(fake.queries[0], "INSERT INTO ingredient") || !strings.Contains(fake.queries[0], "ON DUPLICATE KEY UPDATE") {
			t.Fatalf("query doesn't look like an ingredient upsert: %s", fake.queries[0])
		}
	})

	t.Run("propagates a failing Exec", func(t *testing.T) {
		fake := &fakeExecer{failOn: "INSERT INTO ingredient"}
		if err := insertIngredients(recipe, fake); err == nil {
			t.Fatal("expected an error, got nil")
		}
	})
}

func TestInsertUnits(t *testing.T) {
	recipe := common.Recipe{Ingredients: []common.Ingredient{
		{Name: "flour", Quantity: "200", Unit: "gram"},
		{Name: "egg", Quantity: "2", Unit: ""},
	}}

	t.Run("batches every unit, including a blank one, into one upsert", func(t *testing.T) {
		fake := &fakeExecer{}
		if err := insertUnits(recipe, fake); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(fake.queries) != 1 {
			t.Fatalf("expected 1 query, got %d", len(fake.queries))
		}
		if !strings.Contains(fake.queries[0], "INSERT INTO unit") {
			t.Fatalf("query doesn't look like a unit upsert: %s", fake.queries[0])
		}
	})

	t.Run("propagates a failing Exec", func(t *testing.T) {
		fake := &fakeExecer{failOn: "INSERT INTO unit"}
		if err := insertUnits(recipe, fake); err == nil {
			t.Fatal("expected an error, got nil")
		}
	})
}

func TestInsertParts(t *testing.T) {
	recipe := common.Recipe{
		ID: 42,
		Ingredients: []common.Ingredient{
			{Name: "flour", Quantity: "200", Unit: "gram"},
		},
	}

	t.Run("inserts one part row referencing the recipe", func(t *testing.T) {
		fake := &fakeExecer{}
		if err := insertParts(recipe, fake); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(fake.queries) != 1 {
			t.Fatalf("expected 1 query, got %d", len(fake.queries))
		}
		if !strings.Contains(fake.queries[0], "INSERT INTO part") {
			t.Fatalf("query doesn't look like a part insert: %s", fake.queries[0])
		}
	})

	t.Run("propagates a failing Exec", func(t *testing.T) {
		fake := &fakeExecer{failOn: "INSERT INTO part"}
		if err := insertParts(recipe, fake); err == nil {
			t.Fatal("expected an error, got nil")
		}
	})
}

func TestInsertTags(t *testing.T) {
	recipe := common.Recipe{ID: 42, Tags: []string{"Vegetarian", "Batch Cook"}}

	t.Run("always clears existing tags first, even with none to add", func(t *testing.T) {
		fake := &fakeExecer{}
		if err := insertTags(common.Recipe{ID: 42}, fake); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(fake.queries) != 1 {
			t.Fatalf("expected 1 query (the delete), got %d", len(fake.queries))
		}
		if !strings.Contains(fake.queries[0], "DELETE FROM recipe_tag") {
			t.Fatalf("query doesn't look like the tag delete: %s", fake.queries[0])
		}
	})

	t.Run("clears then inserts every tag", func(t *testing.T) {
		fake := &fakeExecer{}
		if err := insertTags(recipe, fake); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(fake.queries) != 2 {
			t.Fatalf("expected 2 queries (delete + insert), got %d", len(fake.queries))
		}
		if !strings.Contains(fake.queries[1], "INSERT INTO recipe_tag") {
			t.Fatalf("second query doesn't look like a tag insert: %s", fake.queries[1])
		}
	})

	t.Run("propagates a failing delete without attempting the insert", func(t *testing.T) {
		fake := &fakeExecer{failOn: "DELETE FROM recipe_tag"}
		if err := insertTags(recipe, fake); err == nil {
			t.Fatal("expected an error, got nil")
		}
		if len(fake.queries) != 1 {
			t.Fatalf("expected the insert to never run after the delete failed, got %d queries", len(fake.queries))
		}
	})

	t.Run("propagates a failing insert", func(t *testing.T) {
		fake := &fakeExecer{failOn: "INSERT INTO recipe_tag"}
		if err := insertTags(recipe, fake); err == nil {
			t.Fatal("expected an error, got nil")
		}
	})
}

func TestInsertIngredientCatalog(t *testing.T) {
	t.Run("an ingredient with no proposals issues no query", func(t *testing.T) {
		fake := &fakeExecer{}
		recipe := common.Recipe{Ingredients: []common.Ingredient{{Name: "flour", Quantity: "200", Unit: "gram"}}}
		if err := insertIngredientCatalog(recipe, fake); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		// Manual Entry and every edit of an existing Recipe land here.
		if len(fake.queries) != 0 {
			t.Errorf("expected no queries but got %v", fake.queries)
		}
	})

	t.Run("every write is conditional so a curated value cannot be overwritten", func(t *testing.T) {
		fake := &fakeExecer{}
		recipe := common.Recipe{Ingredients: []common.Ingredient{{
			Name: "sumac", Quantity: "2", Unit: "teaspoon",
			BaseUnit: "gram", UnitSizes: map[string]float64{"millilitre": 0.5},
		}}}
		if err := insertIngredientCatalog(recipe, fake); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		joined := strings.Join(fake.queries, "\n")
		// This is the whole safety property of the phase: a value reviewed by a
		// person in migration 025 must survive a later import proposing another.
		if !strings.Contains(joined, "base_unit_id IS NULL") {
			t.Error("base unit write must be conditional on the column being unset")
		}
		if !strings.Contains(joined, "ON DUPLICATE KEY UPDATE") {
			t.Error("unit size write must no-op rather than overwrite an existing row")
		}
		// The guard that actually protects curated values. An unset-column check
		// is not enough: NULL in base_unit_id means both "never curated" and
		// "curated as the default, gram", so without this an import could flip
		// onion to millilitre - which it did, against a live database, before
		// this was added.
		if strings.Count(joined, "NOT EXISTS (SELECT 1 FROM part") != len(fake.queries) {
			t.Errorf("every write must be restricted to ingredients with no lines yet, got %v", fake.queries)
		}
		if strings.Contains(joined, "display_unit_id") {
			t.Error("a nil DisplayUnit should be skipped, not written")
		}
	})

	// "" is the bare-count Unit, and the most useful Display Unit there is, so
	// a proposal of "" must reach the database rather than being mistaken for
	// "nothing proposed".
	t.Run("a proposed bare-count display unit is written", func(t *testing.T) {
		fake := &fakeExecer{}
		count := ""
		recipe := common.Recipe{Ingredients: []common.Ingredient{{
			Name: "sumac", DisplayUnit: &count,
		}}}
		if err := insertIngredientCatalog(recipe, fake); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(strings.Join(fake.queries, "\n"), "display_unit_id IS NULL") {
			t.Errorf("expected a conditional display unit write, got %v", fake.queries)
		}
	})

	t.Run("a non-positive unit size is skipped", func(t *testing.T) {
		fake := &fakeExecer{}
		recipe := common.Recipe{Ingredients: []common.Ingredient{{
			Name: "sumac", UnitSizes: map[string]float64{"": 0, "millilitre": -1},
		}}}
		if err := insertIngredientCatalog(recipe, fake); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(fake.queries) != 0 {
			t.Errorf("expected no queries but got %v", fake.queries)
		}
	})

	t.Run("a failure propagates without attempting the rest", func(t *testing.T) {
		fake := &fakeExecer{failOn: "base_unit_id"}
		recipe := common.Recipe{Ingredients: []common.Ingredient{{
			Name: "sumac", BaseUnit: "gram", UnitSizes: map[string]float64{"millilitre": 0.5},
		}}}
		if err := insertIngredientCatalog(recipe, fake); err == nil {
			t.Fatal("expected an error")
		}
		if len(fake.queries) != 1 {
			t.Errorf("expected to stop after the failing query, got %v", fake.queries)
		}
	})
}
