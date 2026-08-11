package app

import (
	"context"
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
// code already says - and lose the cause entirely. That matters more after
// Session 4 deletes the `log.Println(err)` calls, because at that point the
// span is the only place the cause could live. Wrapping the handler is one
// token per registration and no logic at any call site, which is the spirit of
// the rule if not its letter.
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

// serverError records the real cause of a 500 on the request's span and returns
// an error carrying only the client-facing message.
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
// opaque. register() will additionally record that outer message - two
// exception events on the span, the cause and what the caller was told, which
// is worth more than either alone when reading a trace back.
func serverError(ctx context.Context, msg string, cause error) error {
	telemetry.RecordHandlerError(ctx, cause, http.StatusInternalServerError)
	return huma.Error500InternalServerError(msg)
}
