package app

import (
	"context"
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
	account, err := service.GetAccount(ctx, a.db, userID)

	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Failed to get Account from db"), err)
	}

	return &AccountOutput{Body: *account}, nil
}

func (a *App) addUserToAccount(ctx context.Context, input *AccountUserInput) (*AccountOutput, error) {
	userID := ctx.Value(contextKey("userID")).(string)
	newUser := input.Body

	accountID, err := service.GetAccountID(ctx, a.db, userID)
	if err != nil {
		// Was: log the guess "current user is not associated with an account"
		// and discard err - so a TiDB outage was reported, to the logs and to
		// the user, as a membership problem. fail() puts the real cause on the
		// span and keeps the client's message opaque.
		return nil, fail(ctx, huma.Error500InternalServerError("Could not resolve the current user's account"), err)
	}

	// TODO: Fetch the user ID associated with the email from Auth0
	newUser.ID = "12345"
	newUser.Name = "Anna Feather"

	// TODO: if the user doesn't exist, we should be able to invite them
	if err := service.AddUserToAccount(ctx, a.db, accountID, newUser); err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Failed to add user to account"), err)
	}

	account, err := service.GetAccount(ctx, a.db, userID)
	if err != nil {
		return nil, huma.Error500InternalServerError("Failed to get Account from db")
	}

	return &AccountOutput{Body: *account}, nil
}

func (a *App) removeUserFromAccount(ctx context.Context, input *AccountUserInput) (*AccountOutput, error) {
	userID := ctx.Value(contextKey("userID")).(string)
	outgoingUser := input.Body

	accountID, err := service.GetAccountID(ctx, a.db, userID)
	if err != nil {
		// Was: log the guess "current user is not associated with an account"
		// and discard err - so a TiDB outage was reported, to the logs and to
		// the user, as a membership problem. fail() puts the real cause on the
		// span and keeps the client's message opaque.
		return nil, fail(ctx, huma.Error500InternalServerError("Could not resolve the current user's account"), err)
	}

	// TODO: create the concept of admins
	if err := service.RemoveUserFromAccount(ctx, a.db, accountID, outgoingUser); err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Failed to remove user from account"), err)
	}

	account, err := service.GetAccount(ctx, a.db, userID)
	if err != nil {
		return nil, huma.Error500InternalServerError("Failed to get Account from db")
	}

	return &AccountOutput{Body: *account}, nil
}

func (a *App) registerAccountRoutes(api huma.API) {
	register(api, huma.Operation{
		OperationID: "get-account",
		Method:      http.MethodGet,
		Path:        "/account",
		Summary:     "Get the current user's account",
		Tags:        []string{"Account"},
	}, a.getAccount)

	register(api, huma.Operation{
		OperationID: "add-user-to-account",
		Method:      http.MethodPost,
		Path:        "/account/add",
		Summary:     "Add a user to the current account",
		Tags:        []string{"Account"},
	}, a.addUserToAccount)

	register(api, huma.Operation{
		OperationID: "remove-user-from-account",
		Method:      http.MethodDelete,
		Path:        "/account/remove",
		Summary:     "Remove a user from the current account",
		Tags:        []string{"Account"},
	}, a.removeUserFromAccount)
}
