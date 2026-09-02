package app

import (
	"context"
	"errors"
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

// errNoVerifiedEmail is recorded on the span when a caller reaches an invite
// route with a token that carries no verified address. Not returned to anybody
// - it exists so the rollout is observable: a steady trickle is pre-Action
// tokens ageing out, and a flat line that never falls is the Action not running.
var errNoVerifiedEmail = errors.New("token carries no verified email")

// callerEmail is the address invitations are matched against: the one the
// identity provider asserted inside the signed token, never the one in the
// `user` row.
//
// **The difference is the whole of a live authorisation bug.** `user.email` is
// written from the POST /user body and refreshed on every login, so a caller
// could set it to any address they liked. Every function in this file matched
// invitations on it, and GET /invites returns the invite *token* - so anyone
// with a Big Shop login could name an address, read the invitation sent to it,
// and accept their way into that Account. The token is a capability and this
// was the gate on it.
//
// **There is deliberately no fallback to `user.email`.** A fallback would leave
// the hole open for exactly as long as pre-Action tokens stay in circulation,
// which is the window an attacker would aim at. Auth0 re-runs the post-login
// trigger on refresh-token exchange, so a live session acquires the claim
// without anybody logging in again, and the cost of being strict is that
// somebody mid-refresh briefly sees no invitations.
//
// Empty means "this token predates the claim", not "this person has no email".
func callerEmail(ctx context.Context) string {
	return callerFrom(ctx).VerifiedEmail
}

func (a *App) acceptInvite(ctx context.Context, input *InviteTokenInput) (*struct{}, error) {
	inviteeEmail := callerEmail(ctx)
	if inviteeEmail == "" {
		return nil, huma.Error403Forbidden("Your session predates a security update. Please sign out and back in.")
	}

	currentUser, err := service.GetUser(ctx, a.db, callerFrom(ctx).UserID)
	if err != nil {
		return nil, fail(ctx, huma.Error400BadRequest("Error finding current user"), err)
	}

	invitation, err := service.GetInvite(ctx, a.db, input.Body.Token, inviteeEmail)
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
		return nil, fail(ctx, huma.Error500InternalServerError("Error adding user to the account"), err)
	}

	// remove the invite
	if err := service.DeleteInvite(ctx, a.db, invitation.AccountID, inviteeEmail); err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Error deleting invite"), err)
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
// specs/completed/transactional-email.md exists to remove, rebuilt one level up.
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
	inviteeEmail := callerEmail(ctx)
	if inviteeEmail == "" {
		// An empty list rather than an error, unlike accept and reject. This
		// hangs off the account page's initial load, so answering 403 would put
		// a failure in front of somebody whose only problem is a token a few
		// minutes older than the Action. Nothing is lost: the list reappears on
		// the next refresh, and the emailed link carries the token anyway.
		telemetry.RecordWarning(ctx, "invites listed without a verified email", errNoVerifiedEmail)
		return &InvitesOutput{Body: []common.Invite{}}, nil
	}

	invites, err := service.GetInvites(ctx, a.db, inviteeEmail)
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
	inviteeEmail := callerEmail(ctx)
	if inviteeEmail == "" {
		return nil, huma.Error403Forbidden("Your session predates a security update. Please sign out and back in.")
	}

	invitation, err := service.GetInvite(ctx, a.db, input.Body.Token, inviteeEmail)
	if err != nil {
		return nil, fail(ctx, huma.Error400BadRequest("Error finding invite"), err)
	}

	if err := service.DeleteInvite(ctx, a.db, invitation.AccountID, inviteeEmail); err != nil {
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
