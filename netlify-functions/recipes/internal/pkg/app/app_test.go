package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"recipes/internal/pkg/common"

	"github.com/form3tech-oss/jwt-go"
)

const (
	testAudience = "https://api.bigshop.test"
	testIssuer   = "https://tenant.eu.auth0.com/"
)

func TestNormalizeAudience(t *testing.T) {
	t.Run("converts the []interface{} a JSON array decodes to", func(t *testing.T) {
		claims := jwt.MapClaims{"aud": []interface{}{testAudience, testIssuer + "userinfo"}}

		if err := normalizeAudience(claims); err != nil {
			t.Fatalf("normalizeAudience() error = %v", err)
		}

		got, ok := claims["aud"].([]string)
		if !ok {
			t.Fatalf("aud is %T, want []string", claims["aud"])
		}
		if len(got) != 2 || got[0] != testAudience {
			t.Errorf("aud = %v", got)
		}
	})

	t.Run("leaves a bare string audience alone", func(t *testing.T) {
		claims := jwt.MapClaims{"aud": testAudience}

		if err := normalizeAudience(claims); err != nil {
			t.Fatalf("normalizeAudience() error = %v", err)
		}
		if claims["aud"] != testAudience {
			t.Errorf("aud = %v, want it untouched", claims["aud"])
		}
	})

	// Both of these panicked before, taking the request down with no response
	// rather than refusing it - there is no Recovery middleware in the stack.
	t.Run("rejects a token carrying no audience", func(t *testing.T) {
		if err := normalizeAudience(jwt.MapClaims{"iss": testIssuer}); err == nil {
			t.Error("normalizeAudience() = nil, want an error")
		}
	})

	t.Run("rejects a non-string value in the audience array", func(t *testing.T) {
		claims := jwt.MapClaims{"aud": []interface{}{testAudience, 42}}

		if err := normalizeAudience(claims); err == nil {
			t.Error("normalizeAudience() = nil, want an error")
		}
	})
}

// Guards the `true` (required) argument in GetRouter's VerifyAudience and
// VerifyIssuer calls. Every case here verified successfully under the `false`
// this replaced, which meant any token the Auth0 tenant's key had signed was
// accepted regardless of what it was minted for.
func TestRequiredClaims(t *testing.T) {
	t.Run("an empty audience array does not satisfy the audience", func(t *testing.T) {
		claims := jwt.MapClaims{"aud": []interface{}{}, "iss": testIssuer}
		if err := normalizeAudience(claims); err != nil {
			t.Fatalf("normalizeAudience() error = %v", err)
		}

		if claims.VerifyAudience(testAudience, true) {
			t.Error("VerifyAudience() = true for an empty aud")
		}
	})

	t.Run("a token minted for another audience does not verify", func(t *testing.T) {
		claims := jwt.MapClaims{"aud": []interface{}{"https://other-api.test"}, "iss": testIssuer}
		if err := normalizeAudience(claims); err != nil {
			t.Fatalf("normalizeAudience() error = %v", err)
		}

		if claims.VerifyAudience(testAudience, true) {
			t.Error("VerifyAudience() = true for another audience")
		}
	})

	t.Run("a token carrying no issuer does not verify", func(t *testing.T) {
		claims := jwt.MapClaims{"aud": []string{testAudience}}

		if claims.VerifyIssuer(testIssuer, true) {
			t.Error("VerifyIssuer() = true for a missing iss")
		}
	})

	// The shape Auth0 actually issues: an array holding this API's audience
	// alongside the tenant's /userinfo endpoint.
	t.Run("a genuine access token still verifies", func(t *testing.T) {
		claims := jwt.MapClaims{
			"aud": []interface{}{testAudience, testIssuer + "userinfo"},
			"iss": testIssuer,
		}
		if err := normalizeAudience(claims); err != nil {
			t.Fatalf("normalizeAudience() error = %v", err)
		}

		if !claims.VerifyAudience(testAudience, true) {
			t.Error("VerifyAudience() = false for a genuine token")
		}
		if !claims.VerifyIssuer(testIssuer, true) {
			t.Error("VerifyIssuer() = false for a genuine token")
		}
	})
}

const testBase = "/api/bigshop"

// newRouter builds the real negroni stack over a nil-DB App.
//
// None of the tests here touch the database, and route registration never does
// either, so a nil DB is fine. DISABLE_AUTH is pinned by the caller rather than
// inherited because docker-compose.yml sets it to "true" for the api service,
// so running these through `docker compose run api` would otherwise silently
// take a different branch than the one under test.
func newRouter(t *testing.T, disableAuth string) http.Handler {
	t.Helper()
	t.Setenv("DISABLE_AUTH", disableAuth)
	application, err := NewApp(&common.Env{})
	if err != nil {
		t.Fatalf("NewApp() error = %v", err)
	}
	router, _, err := application.GetRouter(testBase)
	if err != nil {
		t.Fatalf("GetRouter() error = %v", err)
	}
	return router
}

// Every response must carry a cache policy, and the default one must be safe.
//
// The risk this guards is not a missed optimisation: since ADR-0006 browser
// traffic reaches this API through Netlify's edge, and a `public` response on
// an account-scoped route would let one Account's Shopping List be cached from
// an authenticated request and served to whoever asks next (Authorization is
// not part of Netlify's cache key). So `private, no-store` has to be what a
// route gets by *default*, not what it remembers to ask for.
//
// Both cases below are chosen to need no database, and between them they cover
// the two ways a response can be produced: by the middleware stack on its own,
// and by Huma.
func TestDefaultCacheControl(t *testing.T) {
	assertDefault := func(t *testing.T, rec *httptest.ResponseRecorder) {
		t.Helper()
		if got := rec.Header().Get("Cache-Control"); got != defaultCacheControl {
			t.Errorf("Cache-Control = %q, want %q", got, defaultCacheControl)
		}
	}

	// Refused by the JWT middleware, well before routing - so this pins that
	// the header survives a response no handler was ever asked for.
	t.Run("on a 401 the JWT middleware produces", func(t *testing.T) {
		rec := httptest.NewRecorder()
		newRouter(t, "").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, testBase+"/shopping-list", nil))

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401; this test proves nothing otherwise", rec.Code)
		}
		assertDefault(t, rec)
	})

	// Past auth and into Huma, which rejects the malformed body itself without
	// calling the handler - so nothing reaches the nil DB. This is the path
	// that matters: Huma writes the output struct's own headers here, and from
	// the next session on, three routes use exactly that mechanism to override
	// this default. A middleware that only survived to the auth layer would
	// look fine on the case above and be useless in production.
	t.Run("on a response Huma produces", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, testBase+"/recipe", strings.NewReader("not json"))
		req.Header.Set("Content-Type", "application/json")

		rec := httptest.NewRecorder()
		newRouter(t, "true").ServeHTTP(rec, req)

		// 400, not 422: Huma cannot parse the body at all, so it never gets as
		// far as validating it against the schema.
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400; the request reached somewhere unexpected", rec.Code)
		}
		assertDefault(t, rec)
	})
}

// The /health carve-out sits ahead of CORS and the JWT middleware in the
// negroni stack, which is the only reason an uptime monitor or Fly's health
// check - neither of which can hold an Auth0 token - can reach it at all. That
// makes it easy to break by reordering middleware and not notice, since every
// other route would carry on working.
//
// Deliberately exercised with auth *enabled*: a 200 here means the request
// never reached the JWT middleware. No token is ever presented, so the JWT
// middleware rejects before it would fetch JWKS - no network.
func TestHealthCarveOut(t *testing.T) {
	const base = testBase

	status := func(t *testing.T, method, path string) int {
		t.Helper()
		rec := httptest.NewRecorder()
		newRouter(t, "").ServeHTTP(rec, httptest.NewRequest(method, path, nil))
		return rec.Code
	}

	t.Run("answers under the base path, which is what fly.toml checks", func(t *testing.T) {
		rec := httptest.NewRecorder()
		newRouter(t, "").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, base+"/health", nil))

		if rec.Code != http.StatusOK {
			t.Errorf("GET %s/health = %d, want 200", base, rec.Code)
		}
		if got := rec.Body.String(); got != "ok" {
			t.Errorf("body = %q, want %q", got, "ok")
		}
	})

	// The alias. Without it this returned 401, because the request fell past
	// the carve-out into the JWT middleware - confusing enough that it was the
	// first thing reported after the Fly app went live.
	t.Run("answers at the root as well", func(t *testing.T) {
		if code := status(t, http.MethodGet, "/health"); code != http.StatusOK {
			t.Errorf("GET /health = %d, want 200", code)
		}
	})

	// The carve-out answers before any handler runs, so the only thing that can
	// give it a cache policy is the middleware sitting above it.
	t.Run("carries the default cache policy", func(t *testing.T) {
		rec := httptest.NewRecorder()
		newRouter(t, "").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))

		if got := rec.Header().Get("Cache-Control"); got != defaultCacheControl {
			t.Errorf("Cache-Control = %q, want %q", got, defaultCacheControl)
		}
	})

	// The carve-out is GET-only, so a HEAD falls past it. Worth pinning, because
	// `curl -I` against /health then fails on a perfectly healthy deploy - which
	// has already sent one runbook verification check the wrong way. Asserted as
	// "not 200" rather than a specific code: what it becomes (401 from auth, 404
	// from the mux) is not the point, only that it is not served.
	t.Run("does not carve out non-GET methods", func(t *testing.T) {
		if code := status(t, http.MethodHead, "/health"); code == http.StatusOK {
			t.Error("HEAD /health = 200; the carve-out is meant to be GET-only")
		}
	})
}
