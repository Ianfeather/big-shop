// Carries the current trace across the hop from this runtime into the Go API.
//
// This is the join that makes a Dave turn one trace rather than two disconnected
// ones. Dave's handler starts a span in a Netlify function in us-east-2; each
// tool call it makes is an HTTP request to the Go API on Fly in Frankfurt, which
// starts a span of its own. Without a `traceparent` header those spans belong to
// different traces and nothing connects the question to the four queries it
// caused.
//
// The Go side is already the cooperative end: its telemetry setup installs the
// W3C TraceContext propagator, so an inbound traceparent is picked up and its
// server span becomes a child of whatever span was active here. It has been
// waiting for this since Phase 1.
//
// Propagation runs in this direction only. ADR-0007 is explicit that the browser
// does not propagate: the backend hop is where the causality lives, and client
// spans are where the time goes.

import { context, propagation } from '@opentelemetry/api';

// Adds `traceparent` (and `baggage`, if any) to an outbound request's headers.
//
// Returns a new object rather than mutating, so a caller building headers from a
// shared literal cannot accidentally leak one request's trace onto another's.
// With no active span, or with telemetry disabled entirely, the global
// propagator is a no-op and this returns the headers unchanged - which is the
// behaviour that lets every call site use it unconditionally.
export function withTraceHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const carrier: Record<string, string> = { ...headers };
  propagation.inject(context.active(), carrier);
  return carrier;
}
