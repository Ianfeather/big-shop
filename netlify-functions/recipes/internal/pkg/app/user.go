package app

import (
	"context"
	"fmt"
	"log"
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
	user.ID = ctx.Value(contextKey("userID")).(string)

	if err := service.AddUser(a.db, user); err != nil {
		log.Println("Error: could not add new user")
		return nil, huma.Error500InternalServerError("could not add new user")
	}

	if err := service.CreateAccount(a.db, user); err != nil {
		log.Println("Error creating account for user")
		return nil, huma.Error500InternalServerError("Error creating account for user")
	}

	// Re-fetch rather than echoing the input body: `onboarded` is server-managed
	// (untouched by the upsert in AddUser for existing rows), so the caller needs
	// the DB's current value to know whether to show the onboarding screen.
	saved, err := service.GetUser(a.db, user.ID)
	if err != nil {
		log.Println("Error fetching saved user")
		return nil, huma.Error500InternalServerError("Error fetching saved user")
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
	userID := ctx.Value(contextKey("userID")).(string)

	user, err := service.GetUser(a.db, userID)
	if err != nil {
		// Also the no-rows case: someone who reached an inner page before POST
		// /user ever ran for them. Not a server fault, and the client treats it
		// as "no preferences recorded yet" rather than as an error.
		log.Println("Error fetching user")
		return nil, huma.Error404NotFound("user not found")
	}

	return &UserOutput{Body: *user}, nil
}

func (a *App) setPreferences(ctx context.Context, input *PreferencesInput) (*UserOutput, error) {
	userID := ctx.Value(contextKey("userID")).(string)

	if err := service.SetShowPantryStaples(a.db, userID, input.Body.ShowPantryStaples); err != nil {
		log.Println("Error saving preferences")
		return nil, huma.Error500InternalServerError("could not save preferences")
	}

	saved, err := service.GetUser(a.db, userID)
	if err != nil {
		log.Println("Error fetching saved user")
		return nil, huma.Error500InternalServerError("Error fetching saved user")
	}

	return &UserOutput{Body: *saved}, nil
}

func (a *App) completeOnboarding(ctx context.Context, _ *struct{}) (*UserOutput, error) {
	userID := ctx.Value(contextKey("userID")).(string)

	if err := service.SetOnboarded(a.db, userID); err != nil {
		log.Println("Error completing onboarding")
		return nil, huma.Error500InternalServerError("could not complete onboarding")
	}

	saved, err := service.GetUser(a.db, userID)
	if err != nil {
		log.Println("Error fetching saved user")
		return nil, huma.Error500InternalServerError("Error fetching saved user")
	}

	return &UserOutput{Body: *saved}, nil
}

func (a *App) inviteUser(ctx context.Context, input *UserInput) (*struct{}, error) {
	currentUserID := ctx.Value(contextKey("userID")).(string)
	userToInvite := input.Body

	currentUser, err := service.GetUser(a.db, currentUserID)
	if err != nil {
		log.Println("Error finding current user")
		return nil, huma.Error400BadRequest("Error finding current user")
	}

	account, err := service.GetAccount(a.db, currentUserID)
	if err != nil {
		log.Println("Error finding account for current user")
		return nil, huma.Error400BadRequest("Error finding account for current user")
	}

	// Generate a token and write it to the invites table
	token, _ := common.RandToken(32)
	if err := service.CreateInvite(a.db, token, account.ID, userToInvite.Email, currentUserID); err != nil {
		log.Println("Error creating Invite")
		return nil, huma.Error500InternalServerError("Error creating Invite")
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
		log.Println(err)
		return nil, huma.Error400BadRequest("Error sending email")
	}

	return nil, nil
}

func (a *App) registerUserRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "add-user",
		Method:      http.MethodPost,
		Path:        "/user",
		Summary:     "Add a user",
		Tags:        []string{"Users"},
	}, a.addUser)

	huma.Register(api, huma.Operation{
		OperationID: "get-user",
		Method:      http.MethodGet,
		Path:        "/user",
		Summary:     "Get the signed-in user",
		Tags:        []string{"Users"},
	}, a.getUser)

	huma.Register(api, huma.Operation{
		OperationID: "set-preferences",
		Method:      http.MethodPatch,
		Path:        "/user/preferences",
		Summary:     "Update the signed-in user's view preferences",
		Tags:        []string{"Users"},
	}, a.setPreferences)

	huma.Register(api, huma.Operation{
		OperationID: "complete-onboarding",
		Method:      http.MethodPatch,
		Path:        "/user/onboarding",
		Summary:     "Mark the current user as onboarded",
		Tags:        []string{"Users"},
	}, a.completeOnboarding)

	huma.Register(api, huma.Operation{
		OperationID: "invite-user",
		Method:      http.MethodPost,
		Path:        "/invite",
		Summary:     "Invite a user to the current account",
		Description: "Creates an Invite and emails it to the given address.",
		Tags:        []string{"Invites"},
	}, a.inviteUser)
}
