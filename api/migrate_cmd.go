package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"log"
	"os"

	"recipes/internal/pkg/dbconfig"
	"recipes/internal/pkg/migrate"
)

// defaultMigrationsDir is where the SQL lives relative to this module.
//
// The migrations are outside the module on purpose - fly.toml sits next to the
// Dockerfile so the build context is the Go module and nothing else - which
// means they are *not* in the production image and this subcommand cannot be
// run from the deployed container. That is deliberate rather than a limitation:
// migrations run from a checkout, in CI, before the image that needs them is
// deployed. See .github/workflows/deploy-api.yml.
const defaultMigrationsDir = "../migrations"

// runMigrate applies every migration the database has not recorded.
//
// Usage:
//
//	go run . migrate                        # apply what is pending
//	go run . migrate --dry-run              # say what is pending, change nothing
//	go run . migrate --baseline 042_x.sql   # adopt a hand-migrated database
func runMigrate() {
	fs := flag.NewFlagSet("migrate", flag.ExitOnError)
	dir := fs.String("dir", defaultMigrationsDir, "directory holding the numbered *.sql migrations")
	dryRun := fs.Bool("dry-run", false, "report what would be applied and exit without applying it")
	baseline := fs.String("baseline", "", "record every migration up to and including this filename as applied, without running any of them")
	// os.Args[1] is the subcommand itself.
	_ = fs.Parse(os.Args[2:])

	files, err := migrate.Load(*dir)
	if err != nil {
		log.Fatalf("migrate: %v", err)
	}

	// Its own connection rather than the pool init() opens, because it needs a
	// different DSN - see dbconfig.MigrationDSN for exactly which two settings
	// differ and why. init() returns early for this mode so there is no second
	// pool sitting idle.
	dsn, err := dbconfig.MigrationDSN()
	if err != nil {
		log.Fatalf("migrate: %v", err)
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		log.Fatalf("migrate: opening database: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("migrate: connecting to database: %v", err)
	}

	ctx := context.Background()

	if *baseline != "" {
		recorded, err := migrate.Baseline(ctx, db, files, *baseline)
		if err != nil {
			log.Fatalf("migrate: %v", err)
		}
		if len(recorded) == 0 {
			log.Printf("migrate: nothing to baseline; every migration up to %s was already recorded", *baseline)
			return
		}
		log.Printf("migrate: recorded %d migration(s) as already applied, up to and including %s:", len(recorded), *baseline)
		for _, n := range recorded {
			log.Printf("  %s", n)
		}
		log.Print("migrate: nothing was executed against the database")
		return
	}

	if *dryRun {
		pending, err := migrate.Plan(ctx, db, files)
		if err != nil {
			if err == migrate.ErrNeedsBaseline {
				log.Fatal(baselineInstruction(files))
			}
			log.Fatalf("migrate: %v", err)
		}
		if len(pending) == 0 {
			log.Printf("migrate: up to date; all %d migration(s) applied", len(files))
			return
		}
		log.Printf("migrate: %d migration(s) pending:", len(pending))
		for _, f := range pending {
			log.Printf("  %s", f.Name)
		}
		return
	}

	done, err := migrate.Run(ctx, db, files)
	// Whatever else happened, say what landed. A failure part-way through
	// leaves the migrations before it applied and recorded, and the next run
	// resumes from there - so the list is the difference between "retry it" and
	// "work out what state the schema is in first".
	for _, n := range done {
		log.Printf("migrate: applied %s", n)
	}
	if err != nil {
		if err == migrate.ErrNeedsBaseline {
			log.Fatal(baselineInstruction(files))
		}
		log.Fatalf("migrate: %v", err)
	}
	if len(done) == 0 {
		log.Printf("migrate: up to date; all %d migration(s) already applied", len(files))
		return
	}
	log.Printf("migrate: applied %d migration(s)", len(done))
}

// baselineInstruction is what an un-adopted database gets told, and it is a
// paragraph rather than a sentence because the wrong reaction to it - deleting
// the check, or running every migration against a live schema - is worse than
// the situation it reports.
func baselineInstruction(files []migrate.File) string {
	latest := files[len(files)-1].Name
	return fmt.Sprintf(`migrate: this database has tables but no %s ledger, so there is no record of
which migrations it has already had. That is expected exactly once per database: it is
what every database migrated by hand looks like the first time this command runs.

It will not guess. An empty ledger means "apply everything" on a new database and
"replay two years of migrations over live data" on this one, and those are not
recoverable from each other.

If this database is already up to date with the repo, adopt it:

    go run . migrate --baseline %s

That records every migration up to and including that file as applied and executes
none of them. Check first that the schema really does have what the later ones add.`,
		migrate.TableName, latest)
}
