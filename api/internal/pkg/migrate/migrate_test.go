package migrate

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func file(name, body string) File {
	return File{Name: name, SQL: body, Sum: "sum-of-" + body}
}

func names(files []File) []string {
	out := make([]string, 0, len(files))
	for _, f := range files {
		out = append(out, f.Name)
	}
	return out
}

func TestPendingReturnsUnappliedInOrder(t *testing.T) {
	files := []File{
		file("001_init.sql", "a"),
		file("002_two.sql", "b"),
		file("003_three.sql", "c"),
	}
	applied := []Applied{{Name: "001_init.sql", Sum: "sum-of-a"}}

	pending, err := Pending(files, applied)
	if err != nil {
		t.Fatalf("Pending: %v", err)
	}
	got := names(pending)
	want := []string{"002_two.sql", "003_three.sql"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

// The case this whole package exists for: the repo is one migration ahead of
// the database, and the runner has to say so.
func TestPendingFindsTheOneMissingMigration(t *testing.T) {
	files := []File{
		file("041_account_id_foreign_keys.sql", "a"),
		file("042_featured_recipes.sql", "b"),
	}
	applied := []Applied{{Name: "041_account_id_foreign_keys.sql", Sum: "sum-of-a"}}

	pending, err := Pending(files, applied)
	if err != nil {
		t.Fatalf("Pending: %v", err)
	}
	if len(pending) != 1 || pending[0].Name != "042_featured_recipes.sql" {
		t.Fatalf("got %v, want just 042_featured_recipes.sql", names(pending))
	}
}

func TestPendingIsEmptyWhenEverythingIsApplied(t *testing.T) {
	files := []File{file("001_init.sql", "a"), file("002_two.sql", "b")}
	applied := []Applied{
		{Name: "001_init.sql", Sum: "sum-of-a"},
		{Name: "002_two.sql", Sum: "sum-of-b"},
	}

	pending, err := Pending(files, applied)
	if err != nil {
		t.Fatalf("Pending: %v", err)
	}
	if len(pending) != 0 {
		t.Fatalf("got %v, want nothing pending", names(pending))
	}
}

func TestPendingRejectsAnEditedAppliedMigration(t *testing.T) {
	files := []File{file("001_init.sql", "edited")}
	applied := []Applied{{Name: "001_init.sql", Sum: "sum-of-original"}}

	_, err := Pending(files, applied)
	if err == nil {
		t.Fatal("want an error for an applied migration whose contents changed")
	}
	if !strings.Contains(err.Error(), "001_init.sql") {
		t.Errorf("error should name the file, got: %v", err)
	}
}

// A row written before the checksum column carried anything is "no opinion",
// not "the file changed" - otherwise adding checksums accuses every
// previously-applied migration at once.
func TestPendingToleratesAnEmptyRecordedChecksum(t *testing.T) {
	files := []File{file("001_init.sql", "a"), file("002_two.sql", "b")}
	applied := []Applied{{Name: "001_init.sql", Sum: ""}}

	pending, err := Pending(files, applied)
	if err != nil {
		t.Fatalf("Pending: %v", err)
	}
	if len(pending) != 1 || pending[0].Name != "002_two.sql" {
		t.Fatalf("got %v, want just 002_two.sql", names(pending))
	}
}

// Two branches both adding 043, and the other one merged first. Applying this
// one now would build a schema that no fresh database ever passes through.
func TestPendingRejectsAMigrationThatSortsBelowAnAppliedOne(t *testing.T) {
	files := []File{
		file("042_featured_recipes.sql", "a"),
		file("043_mine.sql", "b"),
		file("044_theirs.sql", "c"),
	}
	applied := []Applied{
		{Name: "042_featured_recipes.sql", Sum: "sum-of-a"},
		{Name: "044_theirs.sql", Sum: "sum-of-c"},
	}

	_, err := Pending(files, applied)
	if err == nil {
		t.Fatal("want an error for a pending migration below the high-water mark")
	}
	if !strings.Contains(err.Error(), "043_mine.sql") {
		t.Errorf("error should name the offending file, got: %v", err)
	}
	if !strings.Contains(err.Error(), "044_theirs.sql") {
		t.Errorf("error should name the high-water mark, got: %v", err)
	}
}

// An empty ledger against files that have never run is the ordinary
// fresh-database case, not the out-of-order one.
func TestPendingOnAnEmptyLedgerReturnsEverything(t *testing.T) {
	files := []File{file("001_init.sql", "a"), file("002_two.sql", "b")}

	pending, err := Pending(files, nil)
	if err != nil {
		t.Fatalf("Pending: %v", err)
	}
	if len(pending) != 2 {
		t.Fatalf("got %v, want both files", names(pending))
	}
}

func TestLoadReadsInFilenameOrderAndHashesContents(t *testing.T) {
	dir := t.TempDir()
	// Written out of order on purpose - Glob returns sorted paths on most
	// systems anyway, so the sort in Load is what this asserts.
	write(t, dir, "003_three.sql", "SELECT 3;")
	write(t, dir, "001_one.sql", "SELECT 1;")
	write(t, dir, "002_two.sql", "SELECT 2;")
	write(t, dir, "notes.txt", "not a migration")

	files, err := Load(dir)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	want := []string{"001_one.sql", "002_two.sql", "003_three.sql"}
	got := names(files)
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
	if files[0].SQL != "SELECT 1;" {
		t.Errorf("contents not read: %q", files[0].SQL)
	}
	if len(files[0].Sum) != 64 {
		t.Errorf("checksum should be a 64-char hex digest, got %q", files[0].Sum)
	}
	if files[0].Sum == files[1].Sum {
		t.Error("different contents produced the same checksum")
	}
}

func TestLoadFailsWhenThereAreNoMigrations(t *testing.T) {
	if _, err := Load(t.TempDir()); err == nil {
		t.Fatal("want an error for a directory with no *.sql files")
	}
}

func write(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
		t.Fatalf("writing %s: %v", name, err)
	}
}

// The real migrations directory has to satisfy the ordering assumption the
// whole scheme rests on: fixed-width numeric prefixes, no duplicates.
func TestRepoMigrationsAreNumberedSoFilenameOrderIsApplyOrder(t *testing.T) {
	files, err := Load("../../../../migrations")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	seen := map[string]string{}
	for _, f := range files {
		if len(f.Name) < 4 || f.Name[3] != '_' {
			t.Errorf("%s does not start with a three-digit prefix and an underscore", f.Name)
			continue
		}
		prefix := f.Name[:3]
		for _, c := range prefix {
			if c < '0' || c > '9' {
				t.Errorf("%s does not start with three digits", f.Name)
				break
			}
		}
		if other, dup := seen[prefix]; dup {
			t.Errorf("%s and %s share the prefix %s, so their apply order is arbitrary", other, f.Name, prefix)
		}
		seen[prefix] = f.Name
	}
}
