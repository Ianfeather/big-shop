// Next.js calls register() once per runtime instance, before any request is
// served. It is the only hook that runs early enough to install global
// OpenTelemetry providers, which is why the SDK setup hangs off it rather than
// off a module imported by the routes.
//
// Registering providers here also buys Next.js's *own* instrumentation for
// free: it emits spans through @opentelemetry/api's global tracer whenever one
// is registered, so page renders and route dispatch appear without this repo
// writing any of it. See lib/telemetry/setup.ts for what gets installed, and
// specs/observability.state.md's Phase 4 corrections for what those built-in
// spans do and do not manage to export from a freezing Lambda.
export async function register() {
  // The SDK is Node-only - it reaches for http, async_hooks and process - and
  // importing it from the edge runtime is a build error rather than a
  // degradation. Nothing in this app runs on the edge today; the guard is here
  // so that adding something later fails soft.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { setupTelemetry } = await import('./lib/telemetry/setup');
  setupTelemetry();
}
