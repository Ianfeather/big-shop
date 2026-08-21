package app

import (
	"context"
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
	currentUser, err := service.GetUser(ctx, a.db, callerFrom(ctx).UserID)
	if err != nil {
		return nil, fail(ctx, huma.Error400BadRequest("Error finding current user"), err)
	}

	invitation, err := service.GetInvite(ctx, a.db, input.Body.Token, currentUser.Email)
	if err != nil {
		return nil, fail(ctx, huma.Error400BadRequest("Error finding invite"), err)
	}

	// Disable the invitee's *old* account, which is the one they are currently
	// resolved to. Named explicitly rather than left to match every membership
	// the user has: see DisableUserAccount, which used to do the latter and
	// could leave someone able to log in and resolve to no Account at all.
	//
	// A user with no current account is not an error here - they are simply
	// joining their first one, and there is nothing to disable.
	if currentUser.AccountID != nil {
		if err := service.DisableUserAccount(ctx, a.db, currentUser.ID, *currentUser.AccountID); err != nil {
			return nil, fail(ctx, huma.Error500InternalServerError("Error disabling user account"), err)
		}
	}

	// Add user to the account
	if err := service.AddUserToAccount(ctx, a.db, invitation.AccountID, *currentUser); err != nil {
		return nil, huma.Error500InternalServerError("Error adding user to the account")
	}

	// remove the invite
	if err := service.DeleteInvite(ctx, a.db, invitation.AccountID, currentUser.Email); err != nil {
		return nil, huma.Error500InternalServerError("Error deleting invite")
	}

	return nil, nil
}

func (a *App) getInvites(ctx context.Context, _ *struct{}) (*InvitesOutput, error) {
	user, err := service.GetUser(ctx, a.db, callerFrom(ctx).UserID)
	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Error finding current user"), err)
	}

	invites, err := service.GetInvites(ctx, a.db, user.Email)
	if err != nil {
		return nil, fail(ctx, huma.Error404NotFound("Error finding invites"), err)
	}

	return &InvitesOutput{Body: invites}, nil
}

// rejectInvite declines an invitation addressed to the caller.
//
// **It resolves the invite before deleting it, and that is a fix rather than a
// refactor.** This used to call DeleteInviteByToken, which matched on the token
// alone - so any authenticated user holding a token could delete an invitation
// addressed to somebody else. It was the one route in the invite family that
// trusted its input; accept had always checked token *and* address.
//
// Resolving first is also what makes Session 3's rejection email possible: a
// blind delete never reads the row, so there is no admin_id to tell.
func (a *App) rejectInvite(ctx context.Context, input *InviteTokenInput) (*struct{}, error) {
	currentUser, err := service.GetUser(ctx, a.db, callerFrom(ctx).UserID)
	if err != nil {
		return nil, fail(ctx, huma.Error400BadRequest("Error finding current user"), err)
	}

	invitation, err := service.GetInvite(ctx, a.db, input.Body.Token, currentUser.Email)
	if err != nil {
		return nil, fail(ctx, huma.Error400BadRequest("Error finding invite"), err)
	}

	if err := service.DeleteInvite(ctx, a.db, invitation.AccountID, currentUser.Email); err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Error deleting invite"), err)
	}

	return nil, nil
}

func (a *App) registerInviteRoutes(api huma.API) {
	register(api, huma.Operation{
		OperationID: "accept-invite",
		Method:      http.MethodPost,
		Path:        "/invite/accept",
		Summary:     "Accept an invite",
		Tags:        []string{"Invites"},
	}, a.acceptInvite)

	register(api, huma.Operation{
		OperationID: "list-invites",
		Method:      http.MethodGet,
		Path:        "/invites",
		Summary:     "List invites for the current user",
		Tags:        []string{"Invites"},
	}, a.getInvites)

	register(api, huma.Operation{
		OperationID: "reject-invite",
		Method:      http.MethodPost,
		Path:        "/invite/reject",
		Summary:     "Reject an invite",
		Tags:        []string{"Invites"},
	}, a.rejectInvite)
}
