package service

import (
	"context"
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
	// args[i] is what queries[i] was called with. Recorded because
	// deleteRecipeData's whole safety property is in its arguments - that every
	// statement is scoped to the account - and a test that only reads the SQL
	// text would pass with the account id left off entirely.
	args   [][]interface{}
	failOn string
}

func (f *fakeExecer) ExecContext(_ context.Context, query string, args ...interface{}) (sql.Result, error) {
	f.queries = append(f.queries, query)
	f.args = append(f.args, args)
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
		if err := insertIngredients(context.Background(), common.Recipe{}, fake); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(fake.queries) != 0 {
			t.Fatalf("expected no queries, got %d", len(fake.queries))
		}
	})

	t.Run("batches every ingredient into one upsert", func(t *testing.T) {
		fake := &fakeExecer{}
		if err := insertIngredients(context.Background(), recipe, fake); err != nil {
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
		if err := insertIngredients(context.Background(), recipe, fake); err == nil {
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
		if err := insertUnits(context.Background(), recipe, fake); err != nil {
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
		if err := insertUnits(context.Background(), recipe, fake); err == nil {
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
		if err := insertParts(context.Background(), recipe, fake); err != nil {
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
		if err := insertParts(context.Background(), recipe, fake); err == nil {
			t.Fatal("expected an error, got nil")
		}
	})
}

func TestInsertTags(t *testing.T) {
	recipe := common.Recipe{ID: 42, Tags: []string{"Vegetarian", "Batch Cook"}}

	t.Run("always clears existing tags first, even with none to add", func(t *testing.T) {
		fake := &fakeExecer{}
		if err := insertTags(context.Background(), common.Recipe{ID: 42}, fake); err != nil {
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
		if err := insertTags(context.Background(), recipe, fake); err != nil {
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
		if err := insertTags(context.Background(), recipe, fake); err == nil {
			t.Fatal("expected an error, got nil")
		}
		if len(fake.queries) != 1 {
			t.Fatalf("expected the insert to never run after the delete failed, got %d queries", len(fake.queries))
		}
	})

	t.Run("propagates a failing insert", func(t *testing.T) {
		fake := &fakeExecer{failOn: "INSERT INTO recipe_tag"}
		if err := insertTags(context.Background(), recipe, fake); err == nil {
			t.Fatal("expected an error, got nil")
		}
	})
}

func TestClassifyNewIngredients(t *testing.T) {
	t.Run("an ingredient with no proposals issues no query", func(t *testing.T) {
		fake := &fakeExecer{}
		recipe := common.Recipe{Ingredients: []common.Ingredient{{Name: "flour", Quantity: "200", Unit: "gram"}}}
		classifyNewIngredients(context.Background(), recipe, fake)
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
		classifyNewIngredients(context.Background(), recipe, fake)

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
		if strings.Count(joined, "curated") != len(fake.queries) {
			t.Errorf("every write must be restricted to uncurated ingredients, got %v", fake.queries)
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
		classifyNewIngredients(context.Background(), recipe, fake)
		if !strings.Contains(strings.Join(fake.queries, "\n"), "display_unit_id IS NULL") {
			t.Errorf("expected a conditional display unit write, got %v", fake.queries)
		}
	})

	t.Run("a non-positive unit size is skipped", func(t *testing.T) {
		fake := &fakeExecer{}
		recipe := common.Recipe{Ingredients: []common.Ingredient{{
			Name: "sumac", UnitSizes: map[string]float64{"": 0, "millilitre": -1},
		}}}
		classifyNewIngredients(context.Background(), recipe, fake)
		if len(fake.queries) != 0 {
			t.Errorf("expected no queries but got %v", fake.queries)
		}
	})

	// The spec is explicit that a classification failure must never fail a
	// recipe save. An earlier version returned an error both callers
	// propagated, so one bad proposal rolled back the whole recipe - and this
	// test asserted that wrong behaviour.
	t.Run("a failure is swallowed and the remaining writes still run", func(t *testing.T) {
		fake := &fakeExecer{failOn: "base_unit_id"}
		recipe := common.Recipe{Ingredients: []common.Ingredient{{
			Name: "sumac", BaseUnit: "gram", UnitSizes: map[string]float64{"millilitre": 0.5},
		}}}

		classifyNewIngredients(context.Background(), recipe, fake)

		if len(fake.queries) != 2 {
			t.Errorf("expected the unit size write to still be attempted, got %v", fake.queries)
		}
	})
}

func TestCanonicalUnit(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		// The case that matters: an abbreviation became a Relative Unit with no
		// factor, so "1 ml" never combined with "200 millilitre".
		{"ml", "millilitre"},
		{"g", "gram"},
		{"tsp", "teaspoon"},
		{"TBSP", "tablespoon"},
		{"Kg", "kilogram"},
		// Plurals fragment just as effectively as abbreviations.
		{"grams", "gram"},
		{"cloves", "clove"},
		// Whitespace is its own fragmentation route: UNIQUE(name) is
		// case-insensitive but not space-insensitive.
		{"  gram  ", "gram"},
		{" tsp", "teaspoon"},
		// Already canonical, or genuinely unknown: left alone. An unrecognised
		// Unit is a supported state - it simply won't combine until it has a
		// Unit Size.
		{"gram", "gram"},
		{"sprig", "sprig"},
		{"", ""},
	} {
		if got := canonicalUnit(tc.in); got != tc.want {
			t.Errorf("canonicalUnit(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestWithCanonicalUnitsDoesNotMutateTheCaller(t *testing.T) {
	original := common.Recipe{Ingredients: []common.Ingredient{{Name: "flour", Unit: "g"}}}

	normalised := withCanonicalUnits(original)

	if normalised.Ingredients[0].Unit != "gram" {
		t.Errorf("expected the copy to be normalised, got %q", normalised.Ingredients[0].Unit)
	}
	// Ingredients is a slice, so a careless implementation would write through
	// the shared backing array into the caller's recipe.
	if original.Ingredients[0].Unit != "g" {
		t.Errorf("caller's recipe was mutated: %q", original.Ingredients[0].Unit)
	}
}

// deleteRecipeData is the only place the delete order lives, so these tests are
// what stop that order drifting. They assert the sequence and the scoping rather
// than the exact SQL text - the tables and their order are the contract, the
// whitespace is not.
func TestDeleteRecipeData(t *testing.T) {
	// The order migrations/015's foreign key forces: everything that references
	// a recipe goes before the recipe itself.
	wantOrder := []string{
		"DELETE FROM part",
		"DELETE FROM recipe_tag",
		"DELETE FROM list",
		"DELETE FROM shopping_list_event",
		"DELETE FROM recipe",
	}

	assertOrder := func(t *testing.T, fake *fakeExecer) {
		t.Helper()
		if len(fake.queries) != len(wantOrder) {
			t.Fatalf("expected %d statements, got %d: %v", len(wantOrder), len(fake.queries), fake.queries)
		}
		for i, want := range wantOrder {
			if !strings.Contains(fake.queries[i], want) {
				t.Errorf("statement %d = %q, want it to contain %q", i, fake.queries[i], want)
			}
		}
	}

	t.Run("nil recipeIDs deletes the whole account", func(t *testing.T) {
		fake := &fakeExecer{}
		if err := deleteRecipeData(context.Background(), fake, 7, nil); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		assertOrder(t, fake)

		// Every statement carries the account id and nothing else - no recipe
		// ids, because "every Recipe in the account" is expressed by their
		// absence.
		for i, args := range fake.args {
			for _, arg := range args {
				if arg != 7 {
					t.Errorf("statement %d (%s) got argument %v, want only the account id 7", i, fake.queries[i], arg)
				}
			}
		}
		// The final DELETE must not select from `recipe` in a subquery: MySQL
		// refuses to delete from a table it is reading in the same statement
		// (error 1093), which is why this one states its scope directly.
		if strings.Contains(fake.queries[4], "SELECT") {
			t.Errorf("the recipe DELETE uses a subquery over its own table, which MySQL rejects: %s", fake.queries[4])
		}
	})

	t.Run("explicit recipeIDs are still filtered through the account", func(t *testing.T) {
		fake := &fakeExecer{}
		if err := deleteRecipeData(context.Background(), fake, 7, []int{11, 12}); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		assertOrder(t, fake)

		// The point of the assertion: ids are never trusted on their own. Each
		// statement scopes by account as well, so passing another Account's
		// recipe ids reaches nothing.
		for i, query := range fake.queries {
			var sawAccount bool
			for _, arg := range fake.args[i] {
				if arg == 7 {
					sawAccount = true
				}
			}
			if !sawAccount {
				t.Errorf("statement %d (%s) is not scoped to the account: args %v", i, query, fake.args[i])
			}
		}
		// list and shopping_list_event carry their own account_id, so they get
		// it twice - once directly, once through the subquery.
		if got := len(fake.args[0]); got != 3 {
			t.Errorf("part delete got %d args, want account + 2 ids", got)
		}
		if got := len(fake.args[2]); got != 4 {
			t.Errorf("list delete got %d args, want account twice + 2 ids", got)
		}
	})

	t.Run("an empty but non-nil slice deletes nothing", func(t *testing.T) {
		fake := &fakeExecer{}
		if err := deleteRecipeData(context.Background(), fake, 7, []int{}); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		// The distinction that matters: collapsing empty into nil would turn
		// "no Recipes selected" into "wipe the account".
		if len(fake.queries) != 0 {
			t.Fatalf("expected no statements, got %v", fake.queries)
		}
	})

	t.Run("a failure part-way through is propagated", func(t *testing.T) {
		// Specifically the shopping_list_event step, because it is the one the
		// foreign key made necessary and the one a rewrite is most likely to
		// drop.
		fake := &fakeExecer{failOn: "shopping_list_event"}
		err := deleteRecipeData(context.Background(), fake, 7, nil)
		if err == nil {
			t.Fatal("expected an error")
		}
		if !strings.Contains(err.Error(), "shopping list events") {
			t.Errorf("error does not name the failing step: %v", err)
		}
		// And it stops there rather than pressing on to delete the recipe,
		// which is what the transaction then rolls back.
		if len(fake.queries) != 4 {
			t.Errorf("expected to stop after the failing statement, ran %d: %v", len(fake.queries), fake.queries)
		}
	})
}

// The permission rule behind Featured Recipes, in the only place it is decided.
//
// specs/completed/featured-recipes.md names getting this backwards as the trap: a check
// on whether the field is *present* rather than whether it *changed* would 403
// every ordinary user editing their own Recipe, because the client round-trips
// the whole object. So the unchanged cases are the ones worth most here, not
// the refusal.
func TestResolveFeatured(t *testing.T) {
	ptr := func(b bool) *bool { return &b }
	adminErr := errors.New("lookup failed")

	newCaller := func(admin bool, err error) *common.Caller {
		return common.NewCaller("auth0|someone", "",
			func() (string, int, error) { return "auth0|someone", 1, nil },
			func() (bool, error) { return admin, err },
		)
	}

	tests := []struct {
		name      string
		submitted *bool
		stored    bool
		admin     bool
		adminErr  error
		want      bool
		wantErr   error
	}{
		// The two that must never 403. A non-admin saving their own Recipe
		// sends the value back exactly as they received it.
		{name: "non-admin echoes false", submitted: ptr(false), stored: false, admin: false, want: false},
		{name: "non-admin echoes true", submitted: ptr(true), stored: true, admin: false, want: true},

		// Silence means "no opinion", which is what every write path predating
		// the field means. It must not be read as false, or an older client
		// would un-publish a Featured Recipe on an unrelated edit.
		{name: "absent leaves a featured recipe featured", submitted: nil, stored: true, admin: false, want: true},
		{name: "absent leaves an ordinary recipe ordinary", submitted: nil, stored: false, admin: false, want: false},

		// Changing it is the admin-only act.
		{name: "non-admin publishing is refused", submitted: ptr(true), stored: false, admin: false, wantErr: ErrNotAdmin},
		{name: "non-admin un-publishing is refused", submitted: ptr(false), stored: true, admin: false, wantErr: ErrNotAdmin},
		{name: "admin publishes", submitted: ptr(true), stored: false, admin: true, want: true},
		{name: "admin un-publishes", submitted: ptr(false), stored: true, admin: true, want: false},

		// A failed lookup is not a refusal - it must not be mistaken for one,
		// or a database blip would read to the caller as "you are not allowed".
		{name: "a failed admin lookup surfaces", submitted: ptr(true), stored: false, adminErr: adminErr, wantErr: adminErr},

		// ...and it is never consulted at all when nothing changed, which is
		// what keeps the query off every ordinary recipe save.
		{name: "no lookup when unchanged", submitted: ptr(false), stored: false, adminErr: adminErr, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := resolveFeatured(tt.submitted, tt.stored, newCaller(tt.admin, tt.adminErr))

			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("error = %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error = %v", err)
			}
			if got != tt.want {
				t.Errorf("resolveFeatured() = %v, want %v", got, tt.want)
			}
		})
	}
}

// The two things a copy must get right, pinned on the INSERT's arguments rather
// than on its SQL text - a test reading only the statement would pass with both
// values left off entirely.
//
// Both are in specs/completed/featured-recipes.md's traps list, and both fail silently:
// a copy that arrived Featured would republish itself out of an Account whose
// owner cannot see the flag, and a copy committed without its provenance is
// invisible to the already-taken check, so the next click on the same email
// link makes a second one.
func TestInsertRecipeTxCarriesFeaturedAndProvenance(t *testing.T) {
	source := 3
	recipe := common.Recipe{
		Name:        "Store Cupboard Tomato Pasta",
		Ingredients: []common.Ingredient{{Name: "flour", Quantity: "200", Unit: "gram"}},
	}

	findInsert := func(f *fakeExecer) []interface{} {
		t.Helper()
		for i, q := range f.queries {
			if strings.Contains(q, "INSERT INTO recipe (") {
				return f.args[i]
			}
		}
		t.Fatal("no recipe insert was issued")
		return nil
	}

	t.Run("a copy is never itself featured, and records where it came from", func(t *testing.T) {
		fake := &fakeExecer{}
		if _, err := insertRecipeTx(context.Background(), fake, recipe, 1, false, &source); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		args := findInsert(fake)
		// (name, slug, remote_url, notes, method, account_id, featured, featured_from)
		if len(args) != 8 {
			t.Fatalf("insert took %d args, want 8", len(args))
		}
		if featured, ok := args[6].(bool); !ok || featured {
			t.Errorf("featured = %v, want false", args[6])
		}
		got, ok := args[7].(*int)
		if !ok || got == nil || *got != source {
			t.Errorf("featured_from = %v, want a pointer to %d", args[7], source)
		}
	})

	t.Run("an ordinary create records no provenance", func(t *testing.T) {
		fake := &fakeExecer{}
		if _, err := insertRecipeTx(context.Background(), fake, recipe, 1, false, nil); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if got := findInsert(fake)[7]; got != (*int)(nil) {
			t.Errorf("featured_from = %v, want nil", got)
		}
	})

	// The admin path still has to be able to publish one.
	t.Run("an admin creating a Featured Recipe sets the flag", func(t *testing.T) {
		fake := &fakeExecer{}
		if _, err := insertRecipeTx(context.Background(), fake, recipe, 1, true, nil); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if featured, ok := findInsert(fake)[6].(bool); !ok || !featured {
			t.Errorf("featured = %v, want true", findInsert(fake)[6])
		}
	})
}
