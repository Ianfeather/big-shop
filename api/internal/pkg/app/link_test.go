package app

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"slices"
	"strings"
	"testing"

	"recipes/internal/pkg/common"
	"recipes/internal/pkg/service"

	"github.com/danielgtaylor/huma/v2"
)

// **The request cannot name a subject.** The identity a completed link grants
// access to is always the caller's own, lifted from the validated token - so a
// field for it here would let a caller start a link that hands some stranger's
// login their account, spelled entirely in public values.
//
// Asserted structurally rather than left to the handler, for the same reason
// CreateUserInput has no Email field: deleting the field is what makes the hole
// unsayable, and a test on the *type* is what stops it being added back by
// somebody reaching for a shape that looks reasonable.
func TestLinkStartInputCannotNameASubject(t *testing.T) {
	body := reflect.TypeOf(LinkStartInput{}.Body)
	if body.NumField() != 1 {
		t.Fatalf("LinkStartInput.Body has %d fields, want exactly 1 (the nonce)", body.NumField())
	}
	if body.Field(0).Name != "Nonce" {
		t.Errorf("LinkStartInput.Body's only field is %q, want Nonce", body.Field(0).Name)
	}
}

// The completion names a token and a nonce, and nothing about who it links.
// Both halves come from the row the token identifies.
func TestLinkCompleteInputCarriesOnlyTheTwoSecrets(t *testing.T) {
	body := reflect.TypeOf(LinkCompleteInput{}.Body)
	var names []string
	for i := 0; i < body.NumField(); i++ {
		names = append(names, body.Field(i).Name)
	}
	if !slices.Equal(names, []string{"Token", "Nonce"}) {
		t.Errorf("LinkCompleteInput.Body has fields %v, want exactly [Token Nonce]", names)
	}
}

// Nothing this route hands back identifies a person at their identity provider.
//
// ADR-0008 §1 keeps the Auth0 subject out of anything user-facing, and this is
// the one pair of routes with a subject in scope that is not the caller's own.
func TestLinkOutputsCarryNoSubject(t *testing.T) {
	for _, out := range []any{LinkStartOutput{}.Body, LinkCompleteOutput{}.Body} {
		body := reflect.TypeOf(out)
		for i := 0; i < body.NumField(); i++ {
			if strings.Contains(strings.ToLower(body.Field(i).Name), "subject") {
				t.Errorf("%s exposes %q", body.Name(), body.Field(i).Name)
			}
		}
	}
}

// Each refusal is a different piece of advice, and the differences are the
// feature - so each has to arrive as its own status and its own message.
func TestLinkRefusal(t *testing.T) {
	cases := []struct {
		err        error
		wantStatus int
		// A phrase the reader has to actually see, chosen for the action it
		// implies rather than for the wording.
		wantPhrase string
	}{
		{service.ErrLinkUnknown, http.StatusBadRequest, "no longer valid"},
		{service.ErrLinkExpired, http.StatusBadRequest, "expired"},
		{service.ErrLinkNonceMismatch, http.StatusBadRequest, "same browser"},
		{service.ErrLinkSameIdentity, http.StatusConflict, "same method"},
		{service.ErrLinkAlreadyLinked, http.StatusConflict, "already reach the same account"},
		// The one refusal with no self-service remedy, so it is the one that
		// names support.
		{service.ErrLinkSourceHasRecipes, http.StatusConflict, "contact support"},
	}

	for _, c := range cases {
		got := linkRefusal(c.err)
		if got == nil {
			t.Errorf("linkRefusal(%v) = nil, want a refusal the caller can act on", c.err)
			continue
		}
		if statusOf(got) != c.wantStatus {
			t.Errorf("linkRefusal(%v) status = %d, want %d", c.err, statusOf(got), c.wantStatus)
		}
		if !strings.Contains(got.Error(), c.wantPhrase) {
			t.Errorf("linkRefusal(%v) = %q, want it to mention %q", c.err, got.Error(), c.wantPhrase)
		}
	}

	// Anything that is not a refusal comes back nil, so the handler builds the
	// 500 itself - on a line that also calls fail(), which is what
	// TestNoHandlerSwallowsTheCauseOfA500 insists on.
	//
	// ErrLinkSourceUnreachable is in this group deliberately. It is not
	// reachable from the flow, and it means our data is in a state it should not
	// be in - which is a 500 and not the caller's problem to read about.
	for _, err := range []error{service.ErrLinkSourceUnreachable, errors.New("the database fell over")} {
		if got := linkRefusal(err); got != nil {
			t.Errorf("linkRefusal(%v) = %v, want nil so the handler answers 500 through fail()", err, got)
		}
	}
}

// **No refusal names the other account, its address or its provider.**
//
// The spec's accepted weakness is that somebody must remember which provider
// they originally used and we cannot tell them: answering turns these routes
// into an account-enumeration oracle, which is the same reason the collision
// screen in the closed PR #138 could not name a provider either. The refusals
// are the obvious place for that to leak back in, because each one is written
// to be helpful.
func TestLinkErrorsNameNobody(t *testing.T) {
	forbidden := []string{"google", "apple", "microsoft", "windowslive", "auth0|", "@"}
	for _, err := range []error{
		service.ErrLinkUnknown,
		service.ErrLinkExpired,
		service.ErrLinkNonceMismatch,
		service.ErrLinkSameIdentity,
		service.ErrLinkAlreadyLinked,
		service.ErrLinkSourceHasRecipes,
	} {
		message := strings.ToLower(linkRefusal(err).Error())
		for _, word := range forbidden {
			if strings.Contains(message, word) {
				t.Errorf("linkError(%v) mentions %q: %q", err, word, message)
			}
		}
	}
}

// Both routes exist, at the paths the frontend and the spec name.
//
// Read off the registered router rather than the source, so this fails if the
// registration is dropped from GetRouter - which is a live way to lose a route
// silently, since nothing else in the Go tests calls them.
func TestLinkRoutesAreRegistered(t *testing.T) {
	t.Setenv("DISABLE_AUTH", "true")
	application, err := NewApp(&common.Env{})
	if err != nil {
		t.Fatalf("NewApp() error = %v", err)
	}
	_, api, err := application.GetRouter(testBase)
	if err != nil {
		t.Fatalf("GetRouter() error = %v", err)
	}

	templates := RouteTemplates(api)
	for _, want := range []string{"/link/start", "/link/complete"} {
		if !slices.Contains(templates, want) {
			t.Errorf("%s is not registered; templates = %v", want, templates)
		}
	}

	// Neither is a GET, and that is not decoration: both write, and a GET would
	// be reachable by navigation - which is exactly the transferable-URL attack
	// the nonce exists to close, handed a second front door.
	for path, op := range api.OpenAPI().Paths {
		if !strings.HasPrefix(path, "/link/") {
			continue
		}
		if op.Get != nil {
			t.Errorf("%s answers GET", path)
		}
		if op.Post == nil {
			t.Errorf("%s does not answer POST", path)
		}
	}
}

// Neither link route may join the unauthenticated catalog carve-out.
//
// GetRouter lets /ingredients, /units and /tags through without a token because
// they are public catalogs served from a shared cache. A route that grants
// access to an Account plainly cannot be, and the carve-out is a literal map of
// paths - so the way this goes wrong is somebody adding a path to it, not
// somebody changing these files.
func TestLinkRoutesAreNotPublic(t *testing.T) {
	router := newRouter(t, "")
	for _, path := range []string{"/link/start", "/link/complete"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, testBase+path, strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("POST %s without a token = %d, want 401", path, rec.Code)
		}
	}
}

// huma.StatusError is what statusOf digs into; asserted here so the table above
// is checking a status the client would really get rather than a default.
var _ huma.StatusError = huma.Error400BadRequest("")
