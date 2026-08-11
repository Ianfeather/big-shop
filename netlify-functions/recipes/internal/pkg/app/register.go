package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"

	"recipes/internal/pkg/telemetry"

	"github.com/danielgtaylor/huma/v2"
)

// register is huma.Register with error recording wrapped around the handler.
//
// ADR-0008 §3 asks for "a single error-recording middleware at the handler
// boundary [that] calls span.RecordError and sets the span status, capturing
// every handler error with no per-call-site work". This is that, in the only
// shape Huma actually allows.
//
// A real `huma.UseMiddleware` middleware cannot do it: middleware sees
// huma.Context, which exposes Status() but not the error the handler returned.
// Recording from there would capture that *something* 500'd - which the status
// code already says - and lose the cause entirely. That is now the whole ball
// game: the `log.Println(err)` calls that used to hold the cause are gone, so
// the span is the only place it lives. Wrapping the handler is one token per
// registration and no logic at any call site, which is the spirit of the rule
// if not its letter.
func register[I, O any](api huma.API, op huma.Operation, handler func(context.Context, *I) (*O, error)) {
	huma.Register(api, op, func(ctx context.Context, in *I) (*O, error) {
		out, err := handler(ctx, in)
		if err != nil {
			telemetry.RecordHandlerError(ctx, err, statusOf(err))
		}
		return out, err
	})
}

// statusOf digs the HTTP status out of a Huma error, defaulting to 500 for
// anything that is not one - an unwrapped error escaping a handler is a bug,
// and 500 is both what Huma will send and the right thing to flag.
func statusOf(err error) int {
	var se huma.StatusError
	if errors.As(err, &se) {
		return se.GetStatus()
	}
	return http.StatusInternalServerError
}

// fail records the real cause on the request's span and returns the
// client-facing error unchanged.
//
// Both halves matter, and doing it the obvious way gets both wrong. Passing the
// cause to huma.Error500InternalServerError(msg, err) looks like it attaches it
// for us; what it actually does is append err.Error() to ErrorModel.Errors,
// which is tagged `json:"errors,omitempty"` and therefore **serialised to the
// client** - so a TiDB failure would put its connection string or schema detail
// in an HTTP response body. And it would still not reach the span, because
// ErrorModel.Error() returns only Detail, so register()'s span.RecordError sees
// the generic message and never the cause.
//
// So the cause goes to the span here, explicitly, and the returned error stays
// whatever the handler decided the client should see. register() will
// additionally record that outer message - two exception events on the span,
// the cause and what the caller was told, which is worth more than either alone
// when reading a trace back.
//
// The span is marked failed on the *cause*, not on the status the client is
// told, and those are not the same judgement. Several handlers answer a failed
// database call with a 400 or a 404 - app/invites.go does it three times - so
// deriving the span status from the client's status would let a TiDB outage
// record as a client mistake and vanish from the error rate. That is the
// account.go bug ADR-0008 §3 describes, rebuilt out of status codes instead of
// messages.
//
// sql.ErrNoRows is the exception, because it is the one cause that is routinely
// *expected*: "no such Recipe" is the API working. Its cause is still recorded,
// only the red flag is withheld.
func fail(ctx context.Context, clientErr, cause error) error {
	status := http.StatusInternalServerError
	if errors.Is(cause, sql.ErrNoRows) {
		status = statusOf(clientErr)
	}
	telemetry.RecordHandlerError(ctx, cause, status)
	return clientErr
}
