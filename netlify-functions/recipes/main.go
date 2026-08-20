package main

import (
	"context"
	"crypto/tls"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"recipes/internal/pkg/app"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/lifecycle"
	"recipes/internal/pkg/service"
	"recipes/internal/pkg/telemetry"

	// The IANA timezone database, compiled into the binary.
	//
	// time.LoadLocation otherwise reads it from the operating system, and this
	// binary ships on distroless/static - a base image with no shell, no package
	// manager and nothing else. The Dockerfile asserts that image carries tzdata;
	// this makes the program not care whether that stays true.
	//
	// It became load-bearing with the onboarding email programme
	// (specs/email.md), which sends at 10:00 in the *recipient's* morning and so
	// resolves a stored zone name for every send. The failure it prevents is the
	// quiet kind: with no database available LoadLocation fails for every zone,
	// every user silently falls back to Europe/London, and the only symptom is
	// mail arriving at the wrong hour on someone else's continent. Nothing errors
	// and no test catches it, because tests run on an image that has tzdata.
	//
	// Costs about 450KB of binary. Cheap for removing a whole class of
	// works-locally-wrong-in-production failure.
	_ "time/tzdata"

	"github.com/XSAM/otelsql"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	negroniadapter "github.com/awslabs/aws-lambda-go-api-proxy/negroni"
	"github.com/danielgtaylor/huma/v2"
	"github.com/go-sql-driver/mysql"
	_ "github.com/go-sql-driver/mysql"
	"github.com/urfave/negroni"
	semconv "go.opentelemetry.io/otel/semconv/v1.30.0"
	"go.opentelemetry.io/otel/trace"
)

var negroniLambda *negroniadapter.NegroniAdapter
var router *negroni.Negroni
var openapiAPI huma.API

// db is the connection pool, held at package level so main can reach it.
//
// It was a local in init() until the onboarding email ticker needed it: the
// ticker is started from the serve branch of main, deliberately and only there,
// so the pool has to outlive the function that opened it.
var db *sql.DB

// purgeConfigured is captured at startup so main can report it. Held here
// rather than read from the environment again so that what is logged is what
// the App actually built, not a second guess at it.
var purgeConfigured bool

// appDB is the database handle init() opened, kept so that maintenance
// subcommands in main() can use the same pool - and the same DSN, TLS config
// and pool limits - as the server does, rather than opening a second one.
var appDB *sql.DB

// routeTemplates is the set of path templates the router registered, used to
// keep span names and metric labels bounded. Captured at startup because it is
// fixed for the life of the process.
var routeTemplates []string

// shutdownTelemetry flushes the three OTel providers at exit. Replaced by
// init() with the real one; telemetry.Setup always returns a callable shutdown
// even when telemetry is disabled or setup failed.
//
// Initialised to a no-op rather than left nil because init() returns early in
// openapi mode, before Setup is ever reached. main() happens to branch away
// before using it there, so a nil would not actually panic today - which is
// exactly the kind of invariant that holds by accident until someone moves a
// line. Cheaper to make it true than to rely on it.
var shutdownTelemetry = func(context.Context) error { return nil }

// basePath is the prefix every route is registered under when this runs as a
// server - the Fly container in production, and `serve` locally - and it is the
// OpenAPI server URL. Netlify rewrites it to the Fly origin with status = 200,
// which keeps the API same-origin to the browser. /api alone would swallow the
// Next.js routes under pages/api, hence the second segment. Changing this means
// regenerating docs/openapi.yaml and types/api.d.ts - both are drift-checked in
// CI.
const basePath = "/api/bigshop"

// lambdaBasePath is what the Netlify Function has always served, and goes on
// serving unchanged.
//
// It is not simply the old value of basePath. Netlify routes a request to a
// function by the function's own path, so the Lambda has to keep registering
// routes under that prefix or it 404s on everything the moment this branch
// deploys. That would quietly destroy the rollback the whole migration rests
// on: specs/api-hosting-migration.md's Phase 4 says rollback is "reverting
// those values and redeploying. The Lambda is still there, still serving its
// old path, untouched" - which is only true if it really is untouched. So the
// two servers coexist through the cooling-off period, on different paths,
// against the same database.
//
// Deleted along with the lambda.Start branch in Phase 5.
const lambdaBasePath = "/.netlify/functions/recipes"

// isOpenAPIMode reports whether the process was invoked as `go run . openapi`,
// which prints the generated OpenAPI spec and exits - no DB connection is
// needed since route registration never touches it.
func isOpenAPIMode() bool {
	return len(os.Args) > 1 && os.Args[1] == "openapi"
}

// isHashInviteEmailsMode reports whether the process was invoked as
// `... hash-invite-emails`, the one-off backfill that converts any plaintext
// address left in `invite.email` into a peppered digest.
//
// A subcommand rather than a line of SQL in migrations/035_invite_email_hash.sql
// because MySQL 8 has SHA2() but no HMAC, and a plain SHA-256 is what that
// migration's header rejects - the address space is enumerable. Running it
// through the same service.HashEmail the read path uses is also the only way to
// guarantee the backfill and the reads agree.
//
// Unlike `openapi`, this one needs the database, so init() runs in full for it.
func isHashInviteEmailsMode() bool {
	return len(os.Args) > 1 && os.Args[1] == "hash-invite-emails"
}

// isPreviewMode reports whether the process was invoked as `go run . preview`,
// which serves the email templates in a browser and sends nothing. Like the
// OpenAPI printer it needs no database.
func isPreviewMode() bool {
	return len(os.Args) > 1 && os.Args[1] == "preview"
}

// isSendTestMode reports whether the process was invoked as
// `go run . send-test --to=... --kind=...`, which sends exactly one email to one
// address and writes nothing to the send log. Needs no database either.
func isSendTestMode() bool {
	return len(os.Args) > 1 && os.Args[1] == "send-test"
}

// isServeMode reports whether the process should run as a plain HTTP server:
// the production container on Fly, `npm run dev:full`, and the e2e stack.
// `dev` is the name this mode had when it was only ever used locally; it is
// still accepted so CLAUDE.md's documented invocation and anyone's muscle
// memory keep working.
func isServeMode() bool {
	return len(os.Args) > 1 && (os.Args[1] == "serve" || os.Args[1] == "dev")
}

// routerBasePath picks the prefix for the mode this process is running in.
// Anything that is not the OpenAPI printer or a server is the Lambda.
func routerBasePath() string {
	if isOpenAPIMode() || isServeMode() {
		return basePath
	}
	return lambdaBasePath
}

func init() {
	mysql.RegisterTLSConfig("tidb", &tls.Config{
		MinVersion: tls.VersionTLS12,
		ServerName: "gateway01.eu-central-1.prod.aws.tidbcloud.com",
	})

	// Both email tools return before the database is opened, exactly as the
	// OpenAPI printer does. Neither needs one: preview renders templates, and
	// send-test deliberately writes no email_send row because a test send is not
	// a send to that user.
	if isPreviewMode() || isSendTestMode() {
		return
	}

	if isOpenAPIMode() {
		application, err := app.NewApp(&common.Env{})
		if err != nil {
			fmt.Println("Failed to create application")
			fmt.Println(err)
			return
		}

		_, api, err := application.GetRouter(basePath)
		if err != nil {
			fmt.Println("Failed to get application router")
			fmt.Println(err)
			return
		}
		openapiAPI = api
		return
	}

	// Telemetry is set up before the database is opened, and the order is
	// load-bearing: otelsql captures the tracer provider when the DB is opened,
	// so a Setup that ran afterwards would leave every query span going to the
	// no-op provider installed by default - instrumentation that looks present
	// and silently emits nothing.
	//
	// The error is deliberately swallowed. Setup already promises never to
	// return a fatal condition (see its doc comment), and the whole point of
	// ADR-0007's "telemetry must never affect the application" is that this
	// line cannot be the reason Big Shop does not start. Unlike the DB ping
	// below, which log.Fatalfs precisely because there is nothing to serve
	// without it.
	shutdownTelemetry, _ = telemetry.Setup(context.Background())

	var err error
	db, err = otelsql.Open("mysql", os.Getenv("DSN"),
		otelsql.WithAttributes(semconv.DBSystemNameMySQL),
		otelsql.WithSpanOptions(otelsql.SpanOptions{
			// Emit a query span only when the caller passed a context that
			// already carries one.
			//
			// Session 3 threaded ctx through the whole service layer, so there
			// are now no context-free DB calls left and this filter rejects
			// nothing in normal operation. It stays as a guard rather than
			// housekeeping: any future query written with db.Query instead of
			// db.QueryContext - or any code path reaching the database outside
			// a request, such as a future migration or cron - would otherwise
			// produce a *root* span, and Tempo would fill with rootless
			// single-span traces that mean nothing. Cheap insurance against a
			// mistake that is silent in every other way.
			SpanFilter: func(ctx context.Context, _ otelsql.Method, _ string, _ []driver.NamedValue) bool {
				return trace.SpanContextFromContext(ctx).IsValid()
			},
			// Connection acquisition is pool bookkeeping, not work anyone is
			// debugging; it would double the span count for no information.
			OmitConnectorConnect: true,
			OmitConnResetSession: true,
			// driver.ErrSkip is not a failure. It is how database/sql and the
			// driver negotiate: the driver declines the fast path, the stack
			// falls back to prepare-then-execute, and the query succeeds. Left
			// recorded, *every* query span carries STATUS_CODE_ERROR and an
			// "exception" event reading "driver: skip fast-path; continue as if
			// unimplemented" - so every trace looks broken, and any error-rate
			// metric or alert built on span status later is measuring nothing
			// but this. Caught by reading the first trace back rather than by
			// assuming it was fine.
			DisableErrSkip: true,
		}),
	)

	if err != nil {
		fmt.Println("Failed to connect to database")
		panic(err.Error())
	}

	configurePool(db)

	if err := db.Ping(); err != nil {
		log.Fatalf("failed to ping: %v", err)
	}

	// db.Stats() as OTel metrics, so the numbers chosen in configurePool can be
	// checked rather than assumed - specifically whether OpenConnections ever
	// approaches maxOpenConns and whether WaitCount is anything but zero. Both
	// are the difference between "the pool is sized right" and "the pool is
	// sized as if it were right", and there was previously no way to tell.
	//
	// Registered after telemetry.Setup, which is what makes the global meter
	// provider real rather than the default no-op - the same ordering trap the
	// tracer provider has above, and silent in exactly the same way. The error
	// is logged and not fatal: ADR-0007's rule is that telemetry never affects
	// the application.
	if _, err := otelsql.RegisterDBStatsMetrics(db, otelsql.WithAttributes(semconv.DBSystemNameMySQL)); err != nil {
		log.Printf("could not register DB pool metrics: %v", err)
	}

	appDB = db

	env := &common.Env{DB: db}

	application, err := app.NewApp(env)

	if err != nil {
		fmt.Println("Failed to create application")
		fmt.Println(err)
	}
	purgeConfigured = application.PurgeConfigured()

	var api huma.API
	router, api, err = application.GetRouter(routerBasePath())
	if err != nil {
		fmt.Println("Failed to get application router")
		fmt.Println(err)
	}

	routeTemplates = app.RouteTemplates(api)

	negroniLambda = negroniadapter.New(router)
}

// Pool limits. `database/sql` applies its own defaults when nothing is set, and
// what was set was nothing - so the pool this API ran on was the zero-decision
// one: unlimited open connections and, the number that actually bit,
// **MaxIdleConns of 2**. Defensible while every container was a short-lived
// Lambda. Since ADR-0006 it is one long-lived server, and #49 measured a TLS
// MySQL connection at ~5.0 round trips to establish (plain TCP: ~3.0), so any
// request that wanted a third connection paid a full handshake for it and then
// threw the connection away on the way out.
//
// That is not hypothetical here: GenerateShoppingList now runs three reads
// concurrently, so a single POST /shopping-list wants three connections. Under
// the old defaults, one of those three was a fresh handshake every time - which
// would have made running them in parallel *slower* than running them in
// series. Hence this before that, and hence maxIdleConns comfortably above the
// per-request fan-out rather than merely equal to it.
const (
	// maxOpenConns is a ceiling on this process, not on the database.
	//
	// The real number it is chosen against: a TiDB Cloud Starter (Serverless)
	// cluster allows **400 concurrent connections** across everything that
	// connects to it, rising to 5,000 only with a spending limit set - which
	// this project does not have. That 400 is shared with the TiDB console, the
	// SQL editor, and scripts/sync-from-prod.sh. One always-on shared-cpu-1x
	// Fly machine (fly.toml) taking 20 of it leaves 95% for everything else,
	// while still allowing six concurrent shopping-list generations at three
	// connections each.
	//
	// Unlimited would be the alternative, and is worse in the one case that
	// matters: a slow query under load, where an unbounded pool answers by
	// opening connections until the cluster refuses them - and a refused
	// connection is an error for every caller, not just the one that caused it.
	// A bounded pool queues instead, which is visible in WaitCount.
	maxOpenConns = 20
	// maxIdleConns is deliberately not the default 2 and not equal to
	// maxOpenConns. Above the three-connection fan-out of the widest request so
	// concurrency does not churn connections, and below the open ceiling so a
	// burst does not leave twenty sockets parked against the cluster for the
	// rest of the day.
	maxIdleConns = 8
	// connMaxLifetime recycles a connection rather than trusting it forever.
	//
	// TiDB Cloud Serverless is reached through a gateway that can drop an idle
	// connection without the client noticing, and a pooled connection that the
	// far end has already closed fails the *next* request to be handed it - an
	// error that looks like a database problem and is really a bookkeeping one.
	// Capping the lifetime bounds how long such a connection can sit in the
	// pool. Five minutes costs one handshake per connection per five minutes at
	// this traffic level, which is not a cost worth optimising against
	// correctness.
	connMaxLifetime = 5 * time.Minute
)

// configurePool sets the connection pool limits deliberately. See the constants
// above for what each is chosen against.
//
// ConnMaxIdleTime is deliberately left unset. It would close connections that
// have been idle "too long", and holding a warm connection through a quiet
// period is precisely what this API wants - ConnMaxLifetime already bounds how
// stale one can get.
func configurePool(db *sql.DB) {
	db.SetMaxOpenConns(maxOpenConns)
	db.SetMaxIdleConns(maxIdleConns)
	db.SetConnMaxLifetime(connMaxLifetime)
}

func handler(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	return negroniLambda.ProxyWithContext(ctx, req)
}

func main() {
	if isPreviewMode() {
		runPreview()
	} else if isSendTestMode() {
		runSendTest()
	} else if isOpenAPIMode() {
		spec, err := openapiAPI.OpenAPI().YAML()
		if err != nil {
			panic(err.Error())
		}
		fmt.Print(string(spec))
	} else if isHashInviteEmailsMode() {
		converted, err := service.HashExistingInviteEmails(context.Background(), appDB)

		// Flushed before reporting, and before any log.Fatal below: this
		// process exits in seconds, so without it the spans for a backfill that
		// went wrong - the one run anybody would want to look at afterwards -
		// are still sitting in the batch processor when it dies. The serve
		// branch flushes for the same reason at the other end of its life.
		flushCtx, cancel := context.WithTimeout(context.Background(), telemetry.ShutdownTimeout)
		_ = shutdownTelemetry(flushCtx)
		cancel()

		if err != nil {
			// Fatal: a partially-completed backfill is worth knowing about
			// loudly. It is idempotent, so the fix is to correct whatever
			// failed and run it again.
			log.Fatalf("hashing invite emails: %v", err)
		}
		log.Printf("converted %d plaintext invite address(es); none remain", converted)
	} else if isServeMode() {
		// Said once at startup because the failure it describes is silent
		// otherwise: with only one of NETLIFY_PURGE_TOKEN/NETLIFY_SITE_ID set,
		// or neither, /units is never invalidated and simply expires on its
		// s-maxage. That is the correct behaviour locally and in CI, and a
		// misconfiguration on Fly - and nothing else distinguishes the two.
		if purgeConfigured {
			log.Println("edge cache purging enabled")
		} else {
			log.Println("edge cache purging disabled (NETLIFY_PURGE_TOKEN and NETLIFY_SITE_ID must both be set); /units will expire on its s-maxage instead")
		}

		// This branch is no longer dev-only: it is what the production
		// container on Fly runs too (see Dockerfile), so its timeouts now
		// apply to real traffic for the first time - the lambda.Start path
		// below never used them. The old 3s read/write pair would have cut
		// off anything slower than that, shopping-list generation being the
		// obvious candidate. WriteTimeout covers handler execution, and sits
		// above the Netlify proxy's own 26s ceiling so the proxy is what
		// gives up first rather than the origin truncating a response
		// mid-flight.
		if telemetry.Enabled() {
			log.Println("telemetry enabled, exporting to " + os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"))
		} else {
			log.Println("telemetry disabled (set OTEL_EXPORTER_OTLP_ENDPOINT to enable)")
		}

		// The onboarding email sequence's hourly ticker.
		//
		// Started here and nowhere else, which is the point: this branch is the
		// single always-on Fly machine, so there is exactly one ticker in
		// existence. The Lambda branch below must never start one - it would
		// start a fresh ticker on every invocation, each living as long as the
		// invocation and none of them ever reaching the next hour.
		//
		// Given a database and nothing else. With no SendGrid key or no
		// unsubscribe group configured it runs, finds who is due, declines to
		// send, and writes nothing - so the sequence begins correctly whenever
		// the configuration arrives rather than having marked everyone as
		// already mailed. See internal/pkg/lifecycle.
		lifecycle.Start(context.Background(), db)

		server := http.Server{
			Addr:         ":8080",
			ReadTimeout:  10 * time.Second,
			WriteTimeout: 30 * time.Second,
			IdleTimeout:  120 * time.Second,
			// Outside the negroni stack, so the span covers auth, CORS and
			// routing rather than just the handler. Only the server mode is
			// wrapped: the Lambda below is the rollback target from ADR-0006 and
			// is left exactly as it was, which is also why it needs no telemetry
			// of its own - it serves no traffic unless the migration is undone.
			Handler: telemetry.Handler(router, basePath, routeTemplates),
		}
		// Fatal rather than ignored: a bind failure used to exit 0 silently,
		// which on Fly would be a restart loop with no reason recorded.
		//
		// ListenAndServe only returns on failure, so this is the end of the
		// process either way and the buffered telemetry is about to be lost.
		// Flushing first costs a bounded five seconds and means the trace of
		// whatever went wrong immediately beforehand actually arrives.
		err := server.ListenAndServe()
		flushCtx, cancel := context.WithTimeout(context.Background(), telemetry.ShutdownTimeout)
		_ = shutdownTelemetry(flushCtx)
		cancel()
		log.Fatal(err)
	} else {
		lambda.Start(handler)
	}
}
