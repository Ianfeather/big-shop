package app

import (
	"context"
	"net/http"

	"recipes/internal/pkg/service"

	"github.com/danielgtaylor/huma/v2"
)

// ConsentInput is a decision the client is recording.
//
// Its own input type rather than reusing UserInput, for the same reason
// PreferencesInput exists: this is a body a client is allowed to set directly,
// so it must not be a shape through which name, email or onboarded could be
// smuggled in.
//
// `analytics` is a pointer so that `false` is distinguishable from absent.
// Without it, a declined decision and a malformed body carrying no decision at
// all would both arrive as `false`, and the second would be silently recorded
// as the first - writing a consent decision nobody made, into the table whose
// entire purpose is to be trustworthy.
type ConsentInput struct {
	Body struct {
		Analytics     *bool  `json:"analytics" required:"true" doc:"true to grant analytics consent, false to decline or withdraw"`
		PolicyVersion string `json:"policyVersion" required:"true" minLength:"1" doc:"the privacy policy version this decision was made against"`
		Source        string `json:"source" required:"true" enum:"banner,settings,login-sync" doc:"which control produced the decision"`
	}
}

// recordConsent appends the caller's analytics-consent decision.
//
// Always an append - see migrations/034_consent_event.sql. Changing your mind
// writes a second row; nothing here can edit or remove the first.
//
// Returns the saved User rather than the decision alone, matching
// setPreferences and completeOnboarding: the client keeps one cached User
// object, so handing back the whole thing saves it a refetch to learn what the
// server now thinks.
func (a *App) recordConsent(ctx context.Context, input *ConsentInput) (*UserOutput, error) {
	caller := callerFrom(ctx)

	source := service.ConsentSource(input.Body.Source)
	// Huma's enum tag already rejects anything else, so this is belt and braces
	// - but it is cheap, and the failure it guards against is a bad value
	// reaching MySQL, where a non-strict mode would store the empty string and
	// merely warn rather than refuse.
	if !source.Valid() {
		return nil, huma.Error422UnprocessableEntity("unknown consent source")
	}

	// Guaranteed non-nil by `required:"true"`, but dereferencing on that promise
	// alone is how a nil-pointer panic gets into a handler. The explicit branch
	// costs nothing and keeps a malformed body a 422 rather than a 500.
	if input.Body.Analytics == nil {
		return nil, huma.Error422UnprocessableEntity("analytics is required")
	}

	userID, err := caller.UserID()
	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("could not resolve the current user"), err)
	}

	err = service.RecordConsent(
		ctx,
		a.db,
		userID,
		*input.Body.Analytics,
		input.Body.PolicyVersion,
		source,
	)
	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("could not record consent"), err)
	}

	saved, err := service.GetUser(ctx, a.db, userID)
	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Error fetching saved user"), err)
	}

	return &UserOutput{Body: *saved}, nil
}

func (a *App) registerConsentRoutes(api huma.API) {
	register(api, huma.Operation{
		OperationID: "record-consent",
		Method:      http.MethodPost,
		Path:        "/consent",
		Summary:     "Record an analytics-consent decision",
		Description: "Appends the signed-in user's analytics-consent decision. Append-only: " +
			"changing a decision writes a new record rather than replacing the previous one.",
		Tags: []string{"Users"},
	}, a.recordConsent)
}
