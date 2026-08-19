package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/service"
	"recipes/internal/pkg/service/email"

	"github.com/danielgtaylor/huma/v2"
)

// UserInput carries a user body, used to add a new user.
type UserInput struct {
	Body common.User
}

// UserOutput is the response body for a user.
type UserOutput struct {
	Body common.User
}

func (a *App) addUser(ctx context.Context, input *UserInput) (*UserOutput, error) {
	user := input.Body
	user.ID = callerFrom(ctx).UserID

	if err := service.AddUser(ctx, a.db, user); err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("could not add new user"), err)
	}

	if err := service.CreateAccount(ctx, a.db, user); err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Error creating account for user"), err)
	}

	// Re-fetch rather than echoing the input body: `onboarded` is server-managed
	// (untouched by the upsert in AddUser for existing rows), so the caller needs
	// the DB's current value to know whether to show the onboarding screen.
	saved, err := service.GetUser(ctx, a.db, user.ID)
	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Error fetching saved user"), err)
	}

	return &UserOutput{Body: *saved}, nil
}

// PreferencesInput carries the view preferences a user can change. Separate
// from UserInput: this is the only body a client is allowed to set directly, so
// name/email/onboarded can't be smuggled in through it.
type PreferencesInput struct {
	Body struct {
		ShowPantryStaples bool `json:"showPantryStaples"`
	}
}

// getUser returns the signed-in user, including their view preferences.
//
// The frontend previously only ever saw a User as the response body of POST
// /user on the landing page, which left no way for any other page to read user
// state at all.
func (a *App) getUser(ctx context.Context, _ *struct{}) (*UserOutput, error) {
	caller := callerFrom(ctx)

	user, err := service.GetUser(ctx, a.db, caller.UserID)
	if err != nil {
		// The no-rows case is not a fault: someone who reached an inner page
		// before POST /user ever ran for them. The client treats a 404 as "no
		// preferences recorded yet" and does not retry.
		//
		// Anything else has to be a 500, and the distinction started mattering
		// when GetUser gained a second query: it now also reads the consent
		// record, so a genuine database failure - a missing migration, most
		// likely - would otherwise be reported as "this user does not exist"
		// and silently blank every preference instead of erroring. That is the
		// account.go bug ADR-0008 §3 describes, rebuilt out of status codes.
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fail(ctx, huma.Error404NotFound("user not found"), err)
		}
		return nil, fail(ctx, huma.Error500InternalServerError("could not read user"), err)
	}

	return &UserOutput{Body: *user}, nil
}

func (a *App) setPreferences(ctx context.Context, input *PreferencesInput) (*UserOutput, error) {
	caller := callerFrom(ctx)

	if err := service.SetShowPantryStaples(ctx, a.db, caller.UserID, input.Body.ShowPantryStaples); err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("could not save preferences"), err)
	}

	saved, err := service.GetUser(ctx, a.db, caller.UserID)
	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Error fetching saved user"), err)
	}

	return &UserOutput{Body: *saved}, nil
}

func (a *App) completeOnboarding(ctx context.Context, _ *struct{}) (*UserOutput, error) {
	caller := callerFrom(ctx)

	if err := service.SetOnboarded(ctx, a.db, caller.UserID); err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("could not complete onboarding"), err)
	}

	saved, err := service.GetUser(ctx, a.db, caller.UserID)
	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Error fetching saved user"), err)
	}

	return &UserOutput{Body: *saved}, nil
}

func (a *App) inviteUser(ctx context.Context, input *UserInput) (*struct{}, error) {
	caller := callerFrom(ctx)
	userToInvite := input.Body

	currentUser, err := service.GetUser(ctx, a.db, caller.UserID)
	if err != nil {
		return nil, fail(ctx, huma.Error400BadRequest("Error finding current user"), err)
	}

	account, err := service.GetAccount(ctx, a.db, caller)
	if err != nil {
		return nil, fail(ctx, huma.Error400BadRequest("Error finding account for current user"), err)
	}

	// Generate a token and write it to the invites table
	token, _ := common.RandToken(32)
	if err := service.CreateInvite(ctx, a.db, token, account.ID, userToInvite.Email, caller.UserID); err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Error creating Invite"), err)
	}

	// Send the email through the one sending seam (internal/pkg/service/email)
	// rather than building a SendGrid client here. The copy, the sender identity
	// and the "no API key is a clean skip" behaviour all live there now; what is
	// left at this call site is who to send to and what to put in it.
	//
	// Behaviour is deliberately unchanged in one respect that looks like a bug:
	// a send failure still answers 400, even though the Invite row was already
	// written and survives. That is board item #46's to fix - it is changing
	// this handler's error handling for its own reasons, and
	// specs/account-deletion.md degrades this call to 200 - so changing it here
	// would be a second concurrent change to the same flow. The dead accept URL
	// in the template is #46's for the same reason.
	//
	// Note the 400 now happens strictly less often than before: with no
	// SENDGRID_API_KEY set - which is every environment today - the send is a
	// clean skip rather than an error, so POST /invite creates the Invite and
	// returns success instead of failing outright.
	if _, err := email.SendTransactional(ctx,
		email.Recipient{Name: "Big Shop User", Address: userToInvite.Email},
		"You have been invited to join a Big Shop Account",
		"invite",
		inviteEmailData{InviterName: currentUser.Name, Token: token},
	); err != nil {
		return nil, fail(ctx, huma.Error400BadRequest("Error sending email"), err)
	}

	return nil, nil
}

// inviteEmailData is what templates/invite.html renders against. A named type
// rather than an anonymous struct or a map so that a field renamed in Go and
// not in the template fails to compile on one side and is caught by the golden
// test on the other.
type inviteEmailData struct {
	InviterName string
	Token       string
}

func (a *App) registerUserRoutes(api huma.API) {
	register(api, huma.Operation{
		OperationID: "add-user",
		Method:      http.MethodPost,
		Path:        "/user",
		Summary:     "Add a user",
		Tags:        []string{"Users"},
	}, a.addUser)

	register(api, huma.Operation{
		OperationID: "get-user",
		Method:      http.MethodGet,
		Path:        "/user",
		Summary:     "Get the signed-in user",
		Tags:        []string{"Users"},
	}, a.getUser)

	register(api, huma.Operation{
		OperationID: "set-preferences",
		Method:      http.MethodPatch,
		Path:        "/user/preferences",
		Summary:     "Update the signed-in user's view preferences",
		Tags:        []string{"Users"},
	}, a.setPreferences)

	register(api, huma.Operation{
		OperationID: "complete-onboarding",
		Method:      http.MethodPatch,
		Path:        "/user/onboarding",
		Summary:     "Mark the current user as onboarded",
		Tags:        []string{"Users"},
	}, a.completeOnboarding)

	register(api, huma.Operation{
		OperationID: "invite-user",
		Method:      http.MethodPost,
		Path:        "/invite",
		Summary:     "Invite a user to the current account",
		Description: "Creates an Invite and emails it to the given address.",
		Tags:        []string{"Invites"},
	}, a.inviteUser)
}
