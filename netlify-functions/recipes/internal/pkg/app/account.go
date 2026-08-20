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
	caller := callerFrom(ctx)
	account, err := service.GetAccount(ctx, a.db, caller)

	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Failed to get Account from db"), err)
	}

	return &AccountOutput{Body: *account}, nil
}

func (a *App) addUserToAccount(ctx context.Context, input *AccountUserInput) (*AccountOutput, error) {
	caller := callerFrom(ctx)
	newUser := input.Body

	accountID, err := caller.AccountID()
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

	account, err := service.GetAccount(ctx, a.db, caller)
	if err != nil {
		return nil, huma.Error500InternalServerError("Failed to get Account from db")
	}

	return &AccountOutput{Body: *account}, nil
}

func (a *App) removeUserFromAccount(ctx context.Context, input *AccountUserInput) (*AccountOutput, error) {
	caller := callerFrom(ctx)
	outgoingUser := input.Body

	accountID, err := caller.AccountID()
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

	account, err := service.GetAccount(ctx, a.db, caller)
	if err != nil {
		return nil, huma.Error500InternalServerError("Failed to get Account from db")
	}

	return &AccountOutput{Body: *account}, nil
}

// DeleteAccountOutput tells the caller which of the two outcomes happened.
type DeleteAccountOutput struct {
	Body struct {
		// AccountDeleted is true when the departing User was the Account's last
		// member, so the Account and its Recipes went with them; false when the
		// Account was shared and survives.
		//
		// Reported rather than left implicit because the two outcomes are
		// invisible from the outside and are the thing users will be angriest
		// about getting wrong. The UI names the outcome before asking, and this
		// is what lets it confirm which one actually ran.
		AccountDeleted bool `json:"accountDeleted"`
	}
}

// deleteAccount erases the signed-in User, and the Account too if they were its
// last member.
//
// **The caller is always the subject.** There is no user id in the request:
// deletion applies to whoever is authenticated, so there is no way to spell a
// request that deletes somebody else. The account is taken from the Caller for
// the same reason.
func (a *App) deleteAccount(ctx context.Context, _ *struct{}) (*DeleteAccountOutput, error) {
	caller := callerFrom(ctx)

	accountID, err := caller.AccountID()
	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Could not resolve the current user's account"), err)
	}

	// Loaded first, and this ordering is load-bearing rather than incidental:
	// the SendGrid erasure call needs the address, and the transaction is about
	// to delete the row holding it. service.EraseSendGridRecipient takes the
	// address as a parameter and cannot enforce this itself, so it is enforced
	// here.
	user, err := service.GetUser(ctx, a.db, caller.UserID)
	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Could not read the current user"), err)
	}

	accountDeleted, err := service.DeleteUserAndAccount(ctx, a.db, caller.UserID, accountID, user.Email)
	if err != nil {
		// The sequence leaves a gated, retryable Account behind on any failure,
		// so a 500 here genuinely means "try again" rather than "some of your
		// data is gone".
		return nil, fail(ctx, huma.Error500InternalServerError("Could not delete the account"), err)
	}

	out := &DeleteAccountOutput{}
	out.Body.AccountDeleted = accountDeleted
	return out, nil
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

	register(api, huma.Operation{
		OperationID: "delete-account",
		Method:      http.MethodDelete,
		Path:        "/account",
		Summary:     "Delete the signed-in user, and their account if they are its last member",
		Description: "Erases the signed-in User everywhere: their Auth0 identity, their row, " +
			"their consent history and every invite in either direction. If they are the " +
			"last member of their Account, the Account and its Recipes go too; if the " +
			"Account is shared, it and its Recipes stay with the remaining members. " +
			"Takes no body - the subject is always the caller.",
		Tags: []string{"Account"},
	}, a.deleteAccount)
}
