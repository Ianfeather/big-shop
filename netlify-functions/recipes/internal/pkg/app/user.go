package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/service"

	"github.com/danielgtaylor/huma/v2"
	"github.com/sendgrid/sendgrid-go"
	"github.com/sendgrid/sendgrid-go/helpers/mail"
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

	// Send the email
	from := mail.NewEmail("Ian Feather", "info@ianfeather.co.uk")
	subject := "You have been invited to join a BigShop Account"
	to := mail.NewEmail("BigShop User", userToInvite.Email)
	htmlContent := `
    <p>You have been invited to collaborate on a BigShop account by %s!</p>
    <p>You can accept this by clicking below:</p>
    <a href="https://pleeyu7yrd.execute-api.us-east-1.amazonaws.com/prod/invitation/%s">Accept invite</a>
  `
	message := mail.NewSingleEmail(from, subject, to, "", fmt.Sprintf(htmlContent, currentUser.Name, token))
	client := sendgrid.NewSendClient(os.Getenv("SENDGRID_API_KEY"))
	if _, err := client.Send(message); err != nil {
		return nil, fail(ctx, huma.Error400BadRequest("Error sending email"), err)
	}

	return nil, nil
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
