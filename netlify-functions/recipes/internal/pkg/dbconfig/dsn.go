// Package dbconfig turns the database's component environment variables into a
// driver connection string.
//
// A package of its own rather than a file in main, and that is not filing: a
// test in package main runs main's init(), which opens the database and
// log.Fatals when it cannot. The first test ever added to that package
// discovered this by failing in CI - on a bare runner with no TIDB_* set - while
// passing locally, where the api container has them. Testing the thing that
// builds the connection string should not require a database to connect to.
package dbconfig

import (
	"crypto/tls"
	"fmt"
	"net"
	"os"
	"strings"

	"github.com/go-sql-driver/mysql"
)

// tlsConfigName is the name the driver knows our TLS settings by. It appears in
// the generated DSN as `tls=tidb` and nowhere else - nothing outside this file
// needs to know it.
const tlsConfigName = "tidb"

// dsnCollation is pinned *because of* InterpolateParams, not for its own sake.
//
// Interpolation moves parameter escaping out of the server and into the driver,
// and the driver's guard against the multibyte escape-bypass charsets (gbk,
// big5, sjis, cp932, gb2312, gb18030) is
// `InterpolateParams && Collation != "" && unsafeCollations[Collation]`. Since
// driver v1.8 the collation defaults to *empty*, so leaving it unset silently
// disarms that guard. The two belong together; see
// specs/completed/request-model-optimisations.md.
const dsnCollation = "utf8mb4_general_ci"

// DSN assembles the driver's connection string from its components.
//
// # Why this is not just an environment variable
//
// It was one - a single `DSN` secret holding the whole string - and on
// 2026-08-21 that cost production a broken route. The secret had lost
// `parseTime=true`, so `service.GetLatestConsent` could not scan `created_at`
// into a `time.Time` and every `GET /user` answered 500. Nothing else broke,
// because that scan is the only `time.Time` on any request-serving path, and
// nothing noticed for a day, because `GetLatestConsent` returns early on
// `sql.ErrNoRows` and `consent_event` was empty until someone accepted the
// consent banner. A parameter dropped by hand, a route broken with no deploy to
// blame, and one query in the codebase able to reveal it.
//
// The fix is not to validate the string but to stop hand-writing it. Of the
// five things that DSN carried, exactly one is a secret: `.env.tidb` already
// tracks the username, host, port and database name in git, and argues why -
// they "identify the instance but grant nothing without the password". So the
// password stays a secret, the identifiers move to fly.toml's [env] where a
// deploy cannot forget them, and the three query parameters below stop being
// configuration at all. None of them is environment-specific; the local stack
// and production always wanted the same three values, which is what made them
// literals rather than settings.
//
// # Why the TLS ServerName is not written down
//
// It used to be, as a `gateway01.eu-central-1.prod.aws.tidbcloud.com` literal in
// init(), which meant the production hostname existed in three places - here,
// the DSN secret, and .env.tidb - that had to agree with nothing making them.
// Moving TiDB Cloud instances would have updated the secret and left the
// certificate name behind, failing the handshake rather than the lookup. It now
// derives from TIDB_HOST, so there is one hostname.
func DSN() (string, error) {
	host := os.Getenv("TIDB_HOST")
	port := os.Getenv("TIDB_PORT")
	user := os.Getenv("TIDB_USER")
	dbName := os.Getenv("TIDB_DB")

	// LookupEnv rather than Getenv, so an intentionally empty password is
	// distinguishable from an absent one. A local MySQL with no password set is
	// a real configuration; a production secret that failed to reach the
	// process is not, and it must not silently become the former.
	password, passwordSet := os.LookupEnv("TIDB_PASSWORD")

	var missing []string
	for _, v := range []struct {
		name  string
		value string
	}{
		{"TIDB_HOST", host},
		{"TIDB_PORT", port},
		{"TIDB_USER", user},
		{"TIDB_DB", dbName},
	} {
		if v.value == "" {
			missing = append(missing, v.name)
		}
	}
	if !passwordSet {
		missing = append(missing, "TIDB_PASSWORD")
	}
	// Reported together rather than one per run. Every one of these has to be
	// present for the process to serve anything, so failing on the first would
	// just mean finding out about the rest one restart at a time.
	if len(missing) > 0 {
		return "", fmt.Errorf("database configuration is incomplete: %s not set", strings.Join(missing, ", "))
	}

	cfg := mysql.NewConfig()
	cfg.User = user
	cfg.Passwd = password
	cfg.Net = "tcp"
	cfg.Addr = net.JoinHostPort(host, port)
	cfg.DBName = dbName

	// The three that used to be hand-written, and the reason this function
	// exists. ParseTime makes DATETIME/TIMESTAMP columns scan into time.Time
	// rather than []byte; InterpolateParams halves the blocking round trips of
	// every parameterised query by escaping client-side instead of preparing
	// server-side (measured: GET /shopping-list 15.2 -> 9.1); dsnCollation
	// keeps the escape-bypass guard armed, as its own comment explains.
	//
	// **multiStatements must never join them.** An unsafe collation the driver
	// refuses outright, failing at startup; nothing stops multiStatements being
	// combined with InterpolateParams, and it is the setting that would turn any
	// future escaping defect into stacked statements.
	cfg.ParseTime = true
	cfg.InterpolateParams = true
	cfg.Collation = dsnCollation

	// Explicit rather than inferred from the hostname. Guessing would mean that
	// the day a host stops looking like TiDB Cloud, the connection quietly stops
	// being encrypted - a failure with no symptom at all.
	if os.Getenv("TIDB_TLS") == "true" {
		if err := mysql.RegisterTLSConfig(tlsConfigName, &tls.Config{
			MinVersion: tls.VersionTLS12,
			ServerName: host,
		}); err != nil {
			return "", fmt.Errorf("registering the %q TLS config: %w", tlsConfigName, err)
		}
		cfg.TLSConfig = tlsConfigName
	}

	return cfg.FormatDSN(), nil
}
