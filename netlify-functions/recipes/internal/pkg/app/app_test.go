package app

import (
	"testing"

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
