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
