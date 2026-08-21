package dbconfig

import (
	"os"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
)

// setEnv puts the process into a fully configured state, so each test can
// change or unset the one thing it is about.
func setEnv(t *testing.T) {
	t.Helper()
	t.Setenv("TIDB_HOST", "gateway01.eu-central-1.prod.aws.tidbcloud.com")
	t.Setenv("TIDB_PORT", "4000")
	t.Setenv("TIDB_USER", "someuser.root")
	t.Setenv("TIDB_PASSWORD", "hunter2")
	t.Setenv("TIDB_DB", "bigshop")
	t.Setenv("TIDB_TLS", "true")
}

// The regression this whole file exists for. A DSN that reaches the driver
// without these three is not a slower or a laxer connection, it is a broken
// one: production lost parseTime and GET /user answered 500 until someone
// noticed. They are asserted through ParseDSN rather than by string matching so
// the test pins what the driver will actually do, not how FormatDSN spells it.
func TestBuildDSNPinsTheLoadBearingParameters(t *testing.T) {
	setEnv(t)

	dsn, err := DSN()
	if err != nil {
		t.Fatalf("DSN: %v", err)
	}

	cfg, err := mysql.ParseDSN(dsn)
	if err != nil {
		t.Fatalf("the DSN we generated does not parse: %v", err)
	}

	if !cfg.ParseTime {
		t.Error("parseTime is not set: DATETIME columns will scan into []byte and every time.Time read fails")
	}
	if !cfg.InterpolateParams {
		t.Error("interpolateParams is not set: every parameterised query costs two blocking round trips")
	}
	if cfg.Collation != dsnCollation {
		t.Errorf("collation = %q, want %q: an empty collation disarms the driver's escape-bypass guard", cfg.Collation, dsnCollation)
	}
	// Named explicitly because it is the one that would turn an escaping defect
	// into stacked statements, and nothing in the driver refuses it.
	if cfg.MultiStatements {
		t.Error("multiStatements is set, and must never be")
	}
}

func TestBuildDSNAssemblesTheAddress(t *testing.T) {
	setEnv(t)

	dsn, err := DSN()
	if err != nil {
		t.Fatalf("DSN: %v", err)
	}
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil {
		t.Fatalf("the DSN we generated does not parse: %v", err)
	}

	if want := "gateway01.eu-central-1.prod.aws.tidbcloud.com:4000"; cfg.Addr != want {
		t.Errorf("Addr = %q, want %q", cfg.Addr, want)
	}
	if cfg.User != "someuser.root" {
		t.Errorf("User = %q", cfg.User)
	}
	if cfg.Passwd != "hunter2" {
		t.Errorf("Passwd = %q", cfg.Passwd)
	}
	if cfg.DBName != "bigshop" {
		t.Errorf("DBName = %q", cfg.DBName)
	}
}

// TLS is switched by TIDB_TLS alone. Inferring it from the hostname would mean
// that the day the host stops looking like TiDB Cloud, the connection silently
// stops being encrypted.
func TestBuildDSNTLSIsExplicit(t *testing.T) {
	t.Run("on", func(t *testing.T) {
		setEnv(t)
		dsn, err := DSN()
		if err != nil {
			t.Fatalf("DSN: %v", err)
		}
		cfg, err := mysql.ParseDSN(dsn)
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		if cfg.TLSConfig != tlsConfigName {
			t.Errorf("TLSConfig = %q, want %q", cfg.TLSConfig, tlsConfigName)
		}
	})

	t.Run("off", func(t *testing.T) {
		setEnv(t)
		t.Setenv("TIDB_TLS", "")
		dsn, err := DSN()
		if err != nil {
			t.Fatalf("DSN: %v", err)
		}
		cfg, err := mysql.ParseDSN(dsn)
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		if cfg.TLSConfig != "" {
			t.Errorf("TLSConfig = %q, want empty - the local stack speaks plaintext to a container", cfg.TLSConfig)
		}
	})
}

// Missing configuration must stop the process rather than produce a DSN that
// half-works. Every name is reported at once so the fix takes one restart
// rather than one per variable.
func TestBuildDSNReportsEveryMissingVariable(t *testing.T) {
	setEnv(t)
	t.Setenv("TIDB_HOST", "")
	t.Setenv("TIDB_DB", "")

	_, err := DSN()
	if err == nil {
		t.Fatal("DSN succeeded with TIDB_HOST and TIDB_DB unset")
	}
	for _, want := range []string{"TIDB_HOST", "TIDB_DB"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q does not name %s", err, want)
		}
	}
	if strings.Contains(err.Error(), "TIDB_USER") {
		t.Errorf("error %q names TIDB_USER, which was set", err)
	}
}

// An empty password is a real local configuration; an absent one is a secret
// that did not reach the process. Getenv cannot tell them apart, which is why
// DSN uses LookupEnv - and why this is worth a test rather than a comment.
func TestBuildDSNDistinguishesEmptyPasswordFromAbsent(t *testing.T) {
	t.Run("empty is allowed", func(t *testing.T) {
		setEnv(t)
		t.Setenv("TIDB_PASSWORD", "")
		dsn, err := DSN()
		if err != nil {
			t.Fatalf("DSN rejected an empty password: %v", err)
		}
		cfg, err := mysql.ParseDSN(dsn)
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		if cfg.Passwd != "" {
			t.Errorf("Passwd = %q, want empty", cfg.Passwd)
		}
	})

	t.Run("absent is not", func(t *testing.T) {
		setEnv(t)
		os.Unsetenv("TIDB_PASSWORD")
		_, err := DSN()
		if err == nil {
			t.Fatal("DSN succeeded with TIDB_PASSWORD unset")
		}
		if !strings.Contains(err.Error(), "TIDB_PASSWORD") {
			t.Errorf("error %q does not name TIDB_PASSWORD", err)
		}
	})
}
