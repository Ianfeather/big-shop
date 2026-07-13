package app

import (
	"context"
	"log"
	"net/http"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/service"

	"github.com/danielgtaylor/huma/v2"
)

// AccountOutput is the response body for the current user's account.
type AccountOutput struct {
	Body common.Account
}

// AccountUserInput carries a user to add/remove from the account.
type AccountUserInput struct {
	Body common.User
}

func (a *App) getAccount(ctx context.Context, _ *struct{}) (*AccountOutput, error) {
	userID := ctx.Value(contextKey("userID")).(string)
	account, err := service.GetAccount(a.db, userID)

	if err != nil {
		log.Println(err)
		return nil, huma.Error500InternalServerError("Failed to get Account from db")
	}

	return &AccountOutput{Body: *account}, nil
}

func (a *App) addUserToAccount(ctx context.Context, input *AccountUserInput) (*AccountOutput, error) {
	userID := ctx.Value(contextKey("userID")).(string)
	newUser := input.Body

	accountID, err := service.GetAccountID(a.db, userID)
	if err != nil {
		log.Println("Error: current user is not associated with an account")
		return nil, huma.Error500InternalServerError("Current user is not associated with an account")
	}

	// TODO: Fetch the user ID associated with the email from Auth0
	newUser.ID = "12345"
	newUser.Name = "Anna Feather"

	// TODO: if the user doesn't exist, we should be able to invite them
	if err := service.AddUserToAccount(a.db, accountID, newUser); err != nil {
		log.Println("failed to add user to account")
		return nil, huma.Error500InternalServerError("Failed to add user to account")
	}

	account, err := service.GetAccount(a.db, userID)
	if err != nil {
		return nil, huma.Error500InternalServerError("Failed to get Account from db")
	}

	return &AccountOutput{Body: *account}, nil
}

func (a *App) removeUserFromAccount(ctx context.Context, input *AccountUserInput) (*AccountOutput, error) {
	userID := ctx.Value(contextKey("userID")).(string)
	outgoingUser := input.Body

	accountID, err := service.GetAccountID(a.db, userID)
	if err != nil {
		log.Println("Error: current user is not associated with an account")
		return nil, huma.Error500InternalServerError("Current user is not associated with an account")
	}

	// TODO: create the concept of admins
	if err := service.RemoveUserFromAccount(a.db, accountID, outgoingUser); err != nil {
		log.Println("failed to remove user frorm account")
		return nil, huma.Error500InternalServerError("Failed to remove user frorm account")
	}

	account, err := service.GetAccount(a.db, userID)
	if err != nil {
		return nil, huma.Error500InternalServerError("Failed to get Account from db")
	}

	return &AccountOutput{Body: *account}, nil
}

func (a *App) registerAccountRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-account",
		Method:      http.MethodGet,
		Path:        "/account",
		Summary:     "Get the current user's account",
		Tags:        []string{"Account"},
	}, a.getAccount)

	huma.Register(api, huma.Operation{
		OperationID: "add-user-to-account",
		Method:      http.MethodPost,
		Path:        "/account/add",
		Summary:     "Add a user to the current account",
		Tags:        []string{"Account"},
	}, a.addUserToAccount)

	huma.Register(api, huma.Operation{
		OperationID: "remove-user-from-account",
		Method:      http.MethodDelete,
		Path:        "/account/remove",
		Summary:     "Remove a user from the current account",
		Tags:        []string{"Account"},
	}, a.removeUserFromAccount)
}
