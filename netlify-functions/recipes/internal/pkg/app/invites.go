package app

import (
	"context"
	"net/http"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/service"
	"recipes/internal/pkg/service/email"
	"recipes/internal/pkg/telemetry"

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

	// Told after the membership is written and the invite removed, so a failure
	// anywhere above can never send a mail announcing something that did not
	// happen.
	a.tellInviter(ctx, invitation.AdminID, email.KindInviteAccepted)

	return nil, nil
}

// tellInviter sends one of the two invite-outcome emails to whoever sent the
// invitation.
//
// **Both outcomes go through here, and that is deliberate.** They are the same
// event - an invitation reaching a terminal state - and keeping them on one
// path is what stops the pleasant one shipping alone.
//
// Best-effort in two senses. The send itself cannot fail the request, because
// SendTransactionalAsync returns nothing. And a failure to *look up* the
// inviter is swallowed here rather than returned: the invitation has already
// been accepted or rejected by the time this runs, and failing the request
// afterwards would report a failure for work that succeeded - which is the bug
// specs/transactional-email.md exists to remove, rebuilt one level up.
//
// The inviter's address is still plaintext on `user`. Only invite.email is a
// digest, so this direction works and the other never can.
func (a *App) tellInviter(ctx context.Context, adminID string, kind email.Kind) {
	inviter, err := service.GetUser(ctx, a.db, adminID)
	if err != nil {
		telemetry.RecordWarning(ctx, "looking up the inviter to tell them about an invitation", err)
		return
	}

	var data any
	switch kind {
	case email.KindInviteAccepted:
		data = email.InviteAcceptedData{InviterName: inviter.Name}
	case email.KindInviteRejected:
		data = email.InviteRejectedData{InviterName: inviter.Name}
	}

	email.SendTransactionalAsync(ctx,
		email.Recipient{Name: inviter.Name, Address: inviter.Email}, kind, data)
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

	// After the delete, for the same reason accept sends after its writes.
	a.tellInviter(ctx, invitation.AdminID, email.KindInviteRejected)

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
