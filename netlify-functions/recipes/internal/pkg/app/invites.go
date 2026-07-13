package app

import (
	"context"
	"log"
	"net/http"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/service"

	"github.com/danielgtaylor/huma/v2"
)

// InviteTokenInput carries an invite token, used to accept/reject an invite.
type InviteTokenInput struct {
	Body struct {
		Token string
	}
}

// InvitesOutput is the response body for listing invites.
type InvitesOutput struct {
	Body []common.Invite
}

func (a *App) acceptInvite(ctx context.Context, input *InviteTokenInput) (*struct{}, error) {
	currentUser, err := service.GetUser(a.db, ctx.Value(contextKey("userID")).(string))
	if err != nil {
		log.Println("Error finding current user")
		return nil, huma.Error400BadRequest("Error finding current user")
	}

	accountID, err := service.GetInvite(a.db, input.Body.Token, currentUser.Email)
	if err != nil {
		log.Println("Error finding invite")
		return nil, huma.Error400BadRequest("Error finding invite")
	}

	// Disable old user account
	if err := service.DisableUserAccount(a.db, *currentUser); err != nil {
		return nil, huma.Error500InternalServerError("Error disabling user account")
	}

	// Add user to the account
	if err := service.AddUserToAccount(a.db, *accountID, *currentUser); err != nil {
		return nil, huma.Error500InternalServerError("Error adding user to the account")
	}

	// remove the invite
	if err := service.DeleteInvite(a.db, *accountID, currentUser.Email); err != nil {
		return nil, huma.Error500InternalServerError("Error deleting invite")
	}

	return nil, nil
}

func (a *App) getInvites(ctx context.Context, _ *struct{}) (*InvitesOutput, error) {
	user, err := service.GetUser(a.db, ctx.Value(contextKey("userID")).(string))
	if err != nil {
		log.Println("Error finding current user")
		return nil, huma.Error500InternalServerError("Error finding current user")
	}

	invites, err := service.GetInvites(a.db, user.Email)
	if err != nil {
		log.Println("Error finding invites")
		return nil, huma.Error404NotFound("Error finding invites")
	}

	return &InvitesOutput{Body: invites}, nil
}

func (a *App) rejectInvite(ctx context.Context, input *InviteTokenInput) (*struct{}, error) {
	if err := service.DeleteInviteByToken(a.db, input.Body.Token); err != nil {
		return nil, huma.Error500InternalServerError("Error deleting invite")
	}

	return nil, nil
}

func (a *App) registerInviteRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "accept-invite",
		Method:      http.MethodPost,
		Path:        "/invite/accept",
		Summary:     "Accept an invite",
		Tags:        []string{"Invites"},
	}, a.acceptInvite)

	huma.Register(api, huma.Operation{
		OperationID: "list-invites",
		Method:      http.MethodGet,
		Path:        "/invites",
		Summary:     "List invites for the current user",
		Tags:        []string{"Invites"},
	}, a.getInvites)

	huma.Register(api, huma.Operation{
		OperationID: "reject-invite",
		Method:      http.MethodPost,
		Path:        "/invite/reject",
		Summary:     "Reject an invite",
		Tags:        []string{"Invites"},
	}, a.rejectInvite)
}
