package app

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"time"

	"recipes/internal/pkg/common"
	"recipes/internal/pkg/lifecycle"
	"recipes/internal/pkg/service"
	"recipes/internal/pkg/service/email"

	"github.com/danielgtaylor/huma/v2"
)

// UserInput carries a user body. Used by POST /invite, where the Email field is
// the *invitee's* address and genuinely belongs in the request - naming somebody
// else is not a claim about who you are, and no token can carry it.
type UserInput struct {
	Body common.User
}

// CreateUserInput is what POST /user accepts, and it is a distinct type from
// UserInput for one reason: **it has no Email field.**
//
// Reusing common.User here is what made the vulnerability possible. The address
// arrived in the body, was written to `user.email` on every login, and was then
// what `invite.email` was matched against - so the request said who the
// requester was, and the server believed it. Deleting the field is what makes
// that unsayable rather than merely unused: a later edit cannot reintroduce the
// hole by reading a value that no longer exists, and the generated OpenAPI
// schema stops advertising a field the server ignores.
//
// Name and Timezone stay. Neither decides what anybody may reach - one is a
// display string, the other picks the hour an email arrives - so the request is
// the right place for both, and there is no claim to take them from.
type CreateUserInput struct {
	Body struct {
		Name     string `json:"name,omitempty"`
		Timezone string `json:"timezone,omitempty"`
	}
}

// UserOutput is the response body for a user.
type UserOutput struct {
	Body common.User
}

func (a *App) addUser(ctx context.Context, input *CreateUserInput) (*UserOutput, error) {
	caller := callerFrom(ctx)

	// **The only source of the address, with nothing to fall back to.**
	//
	// `user.email` is written from here and read by everything that mails this
	// person or erases them: the welcome email, the fourteen-day onboarding
	// sequence, the deletion confirmation and the SendGrid recipient erasure -
	// and it is what an arriving second login is matched on just below. A body
	// fallback would put every one of those back under the caller's control.
	verified, err := verifiedEmail(ctx)
	if err != nil {
		return nil, err
	}

	// **caller.Subject, not caller.UserID.** This is the one request that
	// decides what the subject resolves to, so it cannot take the answer as its
	// input - for a new person, UserID is only the middleware's fallback to the
	// subject itself, and for a second provider it would already be the linked
	// user, which is the thing being established here.
	userID, created, err := service.LinkOrCreateIdentity(
		ctx, a.db, caller.Subject, verified, input.Body.Name, service.NormaliseTimezone(input.Body.Timezone))
	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("could not add new user"), err)
	}

	// Re-fetch rather than echoing the input: `onboarded` is server-managed and
	// LinkOrCreateIdentity does not touch it, so the caller needs the DB's
	// current value to know whether to show the onboarding screen. It is also
	// how the response carries the *linked* person for a second-provider login,
	// rather than anything about the subject that just arrived.
	saved, err := service.GetUser(ctx, a.db, userID)
	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Error fetching saved user"), err)
	}

	if created {
		a.sendWelcomeEmail(ctx, *saved)
	}

	return &UserOutput{Body: *saved}, nil
}

// welcomeTimeout bounds the background send. Nothing waits on it, so an
// unbounded request would only hold a goroutine open against an unresponsive
// SendGrid.
const welcomeTimeout = 20 * time.Second

// sendWelcomeEmail sends the day 0 email, in the background, best effort.
//
// **It must never fail the request, and it must never delay it.** That is not a
// preference: it is the exact mistake POST /invite makes today, where a send
// failure returns 400 while the Invite row it already wrote survives - the user
// sees an error for something that worked. specs/completed/email.md is explicit that this
// must not be rebuilt here: "The User is created; the email is a courtesy on
// top."
//
// Sent inline rather than left to the ticker because a welcome email arriving
// the next morning is a broken welcome. It is still Day 0 of the Sequence, so if
// this fails - or finds nothing configured - the ticker retries it at 10:00 in
// their own morning like any other email in the sequence. Nothing is recorded
// unless it was genuinely sent, which is what makes that retry happen.
//
// Only called when AddUser reports it actually created the row. POST /user runs
// on every login, so without that check this would send a welcome email every
// time somebody signed in.
func (a *App) sendWelcomeEmail(ctx context.Context, user common.User) {
	// The feature flag, checked before anything else here. This is the one send
	// that fires on a user's request rather than on a schedule, so it is the
	// first thing that would reach a real person if the programme were switched
	// on by accident.
	//
	// Nothing is recorded when it is off, so switching on later starts everyone
	// cleanly rather than finding a log that says they were already mailed.
	if !lifecycle.Enabled() {
		return
	}

	// context.WithoutCancel, not the request context, and this is the subtle
	// part: the request's context is cancelled the moment the response is
	// written, so a goroutine holding it would have its HTTP call to SendGrid
	// aborted almost immediately - intermittently, depending on which won the
	// race. Trace and span context are preserved, so the send still appears
	// under the request that caused it.
	sendCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), welcomeTimeout)

	welcome, err := lifecycle.EmailFor(lifecycle.KindWelcome)
	if err != nil {
		cancel()
		log.Printf("welcome email: %v", err)
		return
	}

	go func() {
		defer cancel()

		// **Claim the send log row before sending, not after.**
		//
		// Everywhere else in this programme the row is written only on success,
		// which is what makes a failure retry rather than vanish. Here that is
		// not sufficient on its own: this path and the ticker are two writers,
		// and if both send-then-record then the primary key protects the log
		// while two emails still reach the inbox. Claiming first makes the key
		// decide who sends.
		//
		// It also makes this correct regardless of whether `created` was right.
		// That flag comes from RowsAffected on an upsert, and a DSN gaining
		// clientFoundRows - a change invisible from this file - would make every
		// login look like an insert. With a claim, the worst that then happens
		// is a wasted lookup; without one, it is a welcome email on every login.
		claimed, err := lifecycle.ClaimSend(sendCtx, a.db, user.ID, lifecycle.KindWelcome, time.Now())
		if err != nil {
			log.Printf("welcome email: could not claim for %s, the ticker will pick it up: %v", user.ID, err)
			return
		}
		if !claimed {
			// Somebody already holds it - a concurrent login, or a retried
			// request. Not a fault, and nothing to say about it.
			return
		}

		sent, err := email.SendLifecycle(sendCtx,
			email.Recipient{Name: user.Name, Address: user.Email},
			welcome.Subject,
			welcome.Template,
			lifecycle.TemplateData{Name: user.Name, Campaign: string(welcome.Kind)},
		)
		if err == nil && sent {
			return
		}

		// The send did not happen, so give the claim back or the ticker will
		// treat this email as already delivered and never retry it. Uses a
		// fresh context: the usual reason to be here is a timeout, and sendCtx
		// is then already expired, so releasing on it would silently do nothing
		// and strand the claim forever.
		releaseCtx, releaseCancel := context.WithTimeout(context.WithoutCancel(ctx), welcomeTimeout)
		defer releaseCancel()
		if releaseErr := lifecycle.ReleaseSend(releaseCtx, a.db, user.ID, lifecycle.KindWelcome); releaseErr != nil {
			log.Printf("welcome email: NOT sent to %s and could not release the claim, so it will never be retried: %v",
				user.ID, releaseErr)
		}
		if err != nil {
			log.Printf("welcome email to %s failed, the ticker will retry it: %v", user.ID, err)
		}
		// !sent with no error is the unconfigured case. The email package
		// already says why, once per process, so this stays quiet.
	}()
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

	userID, err := caller.UserID()
	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("could not resolve the current user"), err)
	}

	user, err := service.GetUser(ctx, a.db, userID)
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

	userID, err := caller.UserID()
	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("could not resolve the current user"), err)
	}

	if err := service.SetShowPantryStaples(ctx, a.db, userID, input.Body.ShowPantryStaples); err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("could not save preferences"), err)
	}

	saved, err := service.GetUser(ctx, a.db, userID)
	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Error fetching saved user"), err)
	}

	return &UserOutput{Body: *saved}, nil
}

func (a *App) completeOnboarding(ctx context.Context, _ *struct{}) (*UserOutput, error) {
	caller := callerFrom(ctx)

	userID, err := caller.UserID()
	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("could not resolve the current user"), err)
	}

	if err := service.SetOnboarded(ctx, a.db, userID); err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("could not complete onboarding"), err)
	}

	saved, err := service.GetUser(ctx, a.db, userID)
	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Error fetching saved user"), err)
	}

	return &UserOutput{Body: *saved}, nil
}

func (a *App) inviteUser(ctx context.Context, input *UserInput) (*struct{}, error) {
	caller := callerFrom(ctx)
	userToInvite := input.Body

	userID, err := caller.UserID()
	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("could not resolve the current user"), err)
	}

	currentUser, err := service.GetUser(ctx, a.db, userID)
	if err != nil {
		return nil, fail(ctx, huma.Error400BadRequest("Error finding current user"), err)
	}

	account, err := service.GetAccount(ctx, a.db, caller)
	if err != nil {
		return nil, fail(ctx, huma.Error400BadRequest("Error finding account for current user"), err)
	}

	// Generate a token and write it to the invites table
	token, _ := common.RandToken(32)
	if err := service.CreateInvite(ctx, a.db, token, account.ID, userToInvite.Email, userID); err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Error creating Invite"), err)
	}

	// **The Invite row is the durable artefact; the email is a courtesy on top.**
	//
	// This used to answer 400 when the send failed, having already written the
	// row above with nothing to roll it back - so the inviter was told their
	// invite had failed while it sat in the database working perfectly. The
	// invitee could accept it; the inviter had been told not to expect that.
	//
	// SendTransactionalAsync returns nothing, so there is no longer an error
	// here to turn into a status code. That is the point of the helper rather
	// than a convenience: specs/completed/account-deletion.md made the degrade
	// mandatory when it hashed invite.email, because after that there is no
	// address left to retry a send from. The row has to be authoritative.
	email.SendTransactionalAsync(ctx,
		email.Recipient{Name: "Big Shop User", Address: userToInvite.Email},
		email.KindInvite,
		email.InviteData{InviterName: currentUser.Name, Token: token},
	)

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
