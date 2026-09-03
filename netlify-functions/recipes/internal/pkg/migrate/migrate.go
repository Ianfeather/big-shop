// Package migrate applies the SQL files in migrations/ to a database and
// records which ones it has applied.
//
// # Why this exists
//
// Until 2026-08-28 migrations were applied to production by hand, in the TiDB
// console, at whatever moment somebody remembered to. The deploy pipeline knew
// nothing about them: .github/workflows/deploy-api.yml gated a release on CI
// passing, on the declared secrets matching the app's, and on the machines
// actually taking the release - three guards, none of which asked whether the
// database had the columns the new code was about to select.
//
// So it shipped code that selected a column that did not exist yet. #133 added
// `featured` to the two single-recipe queries in service.GetRecipeByID and
// GetRecipeBySlug; migration 042 adds that column; the code deployed on merge
// and the migration did not. Every GET /recipe/{id} answered
// 500 "Failed to parse recipe from db" while the Recipe *list* stayed green,
// because recipes.go does not select `featured` - so it presented as "the
// recipe view is broken" rather than as an outage.
//
// # Why no test could have caught it
//
// Every environment a test runs in builds its schema from migrations/*.sql at
// the same commit as the code under test. The e2e suite tears its volumes down
// on every run so the migrations replay from scratch; the dev stack records
// what it replayed on `_migration_status.applied`, the db healthcheck compares
// that set against ./migrations on every check, and `api` depends_on it being
// healthy - so locally the API physically cannot start against a stale schema.
//
// Production was the only environment that could drift and the only one with no
// record of what had been applied. A suite that tests code against a schema
// guaranteed to match it cannot discover that the two have come apart
// somewhere else. This package is the missing record, and the deploy step that
// reads it is the missing guard.
package migrate

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// TableName is the bookkeeping table, created by this package rather than by a
// migration of its own.
//
// A migration cannot create it: the runner has to read the table to decide
// which migrations are pending, so a migration that created it would have to
// have been applied before the runner could ask what had been applied. Owning
// it here - CREATE TABLE IF NOT EXISTS on every run - closes that loop and
// costs one statement.
//
// It deliberately does not reuse `_migration_status`, which the local docker
// init script writes. That table answers a different question ("did the one
// replay this volume ever gets go cleanly?") with one row and a boolean, and it
// is scoped to a throwaway dev volume. This one is a per-file ledger meant to
// last for the life of the production database.
const TableName = "schema_migration"

// File is one migration on disk, with the digest of the bytes that were read.
type File struct {
	Name string // basename, e.g. "042_featured_recipes.sql"
	SQL  string
	// Sum is the SHA-256 of SQL, hex-encoded. Stored when the file is applied
	// so that editing an already-applied migration is caught rather than
	// silently ignored - see Pending.
	Sum string
}

// Load reads every *.sql file in dir, in filename order.
//
// Filename order is the apply order, which is why every migration in this repo
// is numbered. Lexical sort is correct for a fixed-width numeric prefix and
// would not be for a bare integer one ("10" sorting before "9"); the repo has
// used three digits since 001 and this is the thing that depends on it.
func Load(dir string) ([]File, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "*.sql"))
	if err != nil {
		return nil, fmt.Errorf("listing %s: %w", dir, err)
	}
	sort.Strings(paths)

	files := make([]File, 0, len(paths))
	for _, p := range paths {
		body, err := os.ReadFile(p)
		if err != nil {
			return nil, fmt.Errorf("reading %s: %w", p, err)
		}
		sum := sha256.Sum256(body)
		files = append(files, File{
			Name: filepath.Base(p),
			SQL:  string(body),
			Sum:  hex.EncodeToString(sum[:]),
		})
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("no *.sql files found in %s", dir)
	}
	return files, nil
}

// Applied is what the ledger says about one migration that has already run.
type Applied struct {
	Name string
	Sum  string
}

// Pending returns the migrations in files that the ledger has not recorded, in
// apply order, and refuses in the two cases where "just apply what is missing"
// would be wrong.
//
// **A changed file that has already been applied.** The digest recorded when it
// ran no longer matches the bytes on disk, so the database and the repo
// disagree about what that migration did and nothing can reconcile them
// automatically. Editing an applied migration is the mistake; this reports it
// rather than carrying on against a schema that is not what the file describes.
//
// **A pending file that sorts before an applied one.** Two branches both adding
// `043_*.sql`, or a 043 merged after 044 had already run. Applying it now would
// put the schema in a state no fresh database ever passes through - a fresh one
// replays in filename order, this one would not - so the two stop being the
// same schema, silently, and the difference only shows up in whichever
// environment was built the other way. Renumbering the file is the fix, which
// is why the error names it.
func Pending(files []File, applied []Applied) ([]File, error) {
	byName := make(map[string]string, len(applied))
	highest := ""
	for _, a := range applied {
		byName[a.Name] = a.Sum
		if a.Name > highest {
			highest = a.Name
		}
	}

	var changed []string
	var outOfOrder []string
	var pending []File

	for _, f := range files {
		sum, ok := byName[f.Name]
		if ok {
			// A ledger row written before checksums existed carries an empty
			// digest. Treat it as "no opinion" rather than as a mismatch: the
			// alternative is that introducing this field retroactively accuses
			// every previously-applied migration of having been edited.
			if sum != "" && sum != f.Sum {
				changed = append(changed, f.Name)
			}
			continue
		}
		if highest != "" && f.Name < highest {
			outOfOrder = append(outOfOrder, f.Name)
			continue
		}
		pending = append(pending, f)
	}

	if len(changed) > 0 {
		return nil, fmt.Errorf(
			"these migrations have already been applied but their contents have changed since: %s.\n"+
				"An applied migration is a historical record and editing one makes the database and the repo\n"+
				"disagree about what it did. Restore the file, and put the change in a new migration instead",
			strings.Join(changed, ", "))
	}
	if len(outOfOrder) > 0 {
		return nil, fmt.Errorf(
			"these migrations sort before %s, which has already been applied: %s.\n"+
				"Applying them now would produce a schema that no fresh database ever passes through, since a\n"+
				"fresh one replays in filename order. Renumber them above %s and try again",
			highest, strings.Join(outOfOrder, ", "), highest)
	}
	return pending, nil
}

// EnsureTable creates the ledger if it is not there yet.
//
// Note what it does NOT do: it never decides on its own that an empty ledger
// means an empty database. See Status.
func EnsureTable(ctx context.Context, db *sql.DB) error {
	_, err := db.ExecContext(ctx, "CREATE TABLE IF NOT EXISTS `"+TableName+"` (\n"+
		"  `filename` varchar(255) NOT NULL COMMENT 'basename of the file in migrations/',\n"+
		"  `checksum` char(64) NOT NULL COMMENT 'SHA-256 of the file as applied; empty means unknown',\n"+
		"  `applied_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,\n"+
		"  PRIMARY KEY (`filename`)\n"+
		") COLLATE=utf8mb4_bin COMMENT='applied migrations; written by internal/pkg/migrate'")
	if err != nil {
		return fmt.Errorf("creating %s: %w", TableName, err)
	}
	return nil
}

// Ledger reads every recorded migration.
func Ledger(ctx context.Context, db *sql.DB) ([]Applied, error) {
	rows, err := db.QueryContext(ctx, "SELECT filename, checksum FROM `"+TableName+"` ORDER BY filename")
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", TableName, err)
	}
	defer rows.Close()

	var out []Applied
	for rows.Next() {
		var a Applied
		if err := rows.Scan(&a.Name, &a.Sum); err != nil {
			return nil, fmt.Errorf("scanning %s: %w", TableName, err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading %s: %w", TableName, err)
	}
	return out, nil
}

// tableCount reports how many tables the database has, excluding the ledger.
//
// It is the one question that distinguishes "a database nobody has ever
// migrated" from "a database migrated by hand for two years, before this
// package existed". Both have an empty ledger and they want opposite
// treatment, so the runner must not guess - see Run.
func tableCount(ctx context.Context, db *sql.DB) (int, error) {
	var n int
	err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> ?",
		TableName).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("counting tables: %w", err)
	}
	return n, nil
}

// record writes one applied migration into the ledger.
func record(ctx context.Context, db *sql.DB, f File) error {
	_, err := db.ExecContext(ctx,
		"INSERT INTO `"+TableName+"` (filename, checksum) VALUES (?, ?)", f.Name, f.Sum)
	if err != nil {
		return fmt.Errorf("recording %s: %w", f.Name, err)
	}
	return nil
}

// Baseline records every migration up to and including through as applied,
// without running any of them.
//
// This is how a database that was migrated by hand joins the scheme, and it is
// deliberately a separate, explicit invocation rather than something Run infers.
// Production has had all 42 of its migrations applied by a person typing into
// the TiDB console; there is no way for this package to *verify* that from the
// outside, and the two ways of being wrong are not symmetrical. Baselining a
// migration that was never really applied leaves a column missing, which is the
// bug this whole package exists to prevent - bad, but it is the state we were
// already in. Re-applying 042 migrations to a live production database is
// destructive in ways nothing here could undo.
//
// So a human asserts it, once, naming the file they are asserting up to.
func Baseline(ctx context.Context, db *sql.DB, files []File, through string) ([]string, error) {
	if err := EnsureTable(ctx, db); err != nil {
		return nil, err
	}

	found := false
	for _, f := range files {
		if f.Name == through {
			found = true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("no migration named %q; --baseline takes a filename as it appears in the migrations directory", through)
	}

	existing, err := Ledger(ctx, db)
	if err != nil {
		return nil, err
	}
	already := make(map[string]bool, len(existing))
	for _, a := range existing {
		already[a.Name] = true
	}

	var recorded []string
	for _, f := range files {
		if f.Name > through {
			break
		}
		if already[f.Name] {
			continue
		}
		if err := record(ctx, db, f); err != nil {
			return recorded, err
		}
		recorded = append(recorded, f.Name)
	}
	return recorded, nil
}

// ErrNeedsBaseline is returned when the ledger is empty but the database is
// not, which means this database predates the ledger and a human has to say
// how far it has already got.
var ErrNeedsBaseline = fmt.Errorf("database has tables but no migration ledger")

// Plan reports which migrations would be applied, in order, without applying
// any of them.
//
// Run is Plan plus execution, and --dry-run is Plan alone. Sharing it is not
// tidiness: the two must agree about the ambiguous-empty-ledger case below, and
// when they were written separately the dry run reported an un-adopted database
// as an error while a real run reported it as needing a baseline.
func Plan(ctx context.Context, db *sql.DB, files []File) ([]File, error) {
	if err := EnsureTable(ctx, db); err != nil {
		return nil, err
	}

	applied, err := Ledger(ctx, db)
	if err != nil {
		return nil, err
	}

	// An empty ledger is ambiguous and must not be guessed at. On a genuinely
	// empty database it means "apply everything"; on production it would mean
	// replaying two years of migrations over a live schema. Fail closed, and
	// let the caller print the baseline instruction.
	if len(applied) == 0 {
		n, err := tableCount(ctx, db)
		if err != nil {
			return nil, err
		}
		if n > 0 {
			return nil, ErrNeedsBaseline
		}
	}

	return Pending(files, applied)
}

// Run applies every pending migration in order and returns the ones it applied.
//
// Each file is executed as a single multi-statement call and recorded only
// after it succeeds. **There is no transaction around it**, and there cannot
// be: MySQL and TiDB commit implicitly on DDL, so a migration that fails
// halfway leaves the half it managed. That is not a regression - typing the
// same file into a console has always had exactly this property - but it does
// mean a failure here needs a person to look at what landed before the run is
// retried. The error names the file, and the ledger will not contain it.
func Run(ctx context.Context, db *sql.DB, files []File) ([]string, error) {
	pending, err := Plan(ctx, db, files)
	if err != nil {
		return nil, err
	}

	var done []string
	for _, f := range pending {
		if _, err := db.ExecContext(ctx, f.SQL); err != nil {
			return done, fmt.Errorf("applying %s: %w", f.Name, err)
		}
		if err := record(ctx, db, f); err != nil {
			return done, err
		}
		done = append(done, f.Name)
	}
	return done, nil
}
