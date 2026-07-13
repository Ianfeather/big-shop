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

	return &UserOutput{Body: user}, nil
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
		OperationID: "invite-user",
		Method:      http.MethodPost,
		Path:        "/invite",
		Summary:     "Invite a user to the current account",
		Description: "Creates an Invite and emails it to the given address.",
		Tags:        []string{"Invites"},
	}, a.inviteUser)
}
