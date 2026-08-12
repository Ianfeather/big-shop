import type { APIEvent, TransportItem } from '@grafana/faro-web-sdk';
import { describe, expect, it } from 'vitest';
import { APP_NAME, enabled, scrub, setupFaro } from './faro';
import pkg from '../../package.json';

// ADR-0007 and the spec both rule out browser tracing, and the spec files it
// under "do not re-litigate without a load-bearing reason". Grafana's own
// onboarding snippet includes `@grafana/faro-web-tracing` by default, and the
// obvious way for it to arrive here is somebody pasting that snippet in good
// faith - at which point the browser starts dictating trace ids to the backend
// and every visitor pays for the largest package in the Faro bundle.
//
// A comment cannot fail a build. This can.
describe('the no-browser-tracing decision', () => {
  it('keeps @grafana/faro-web-tracing out of the dependency tree', () => {
    const declared = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    } as Record<string, string>;

    expect(Object.keys(declared)).not.toContain('@grafana/faro-web-tracing');
  });
});

describe('enabled', () => {
  it('is off without a collector URL, so a build with no Faro configured does nothing', () => {
    // The same switch as the server side's `enabled()`: the endpoint's presence
    // is the flag, so there is no way to be on and misconfigured.
    expect(enabled()).toBe(false);
  });

  it('setupFaro is a no-op rather than a throw when Faro is not configured', () => {
    expect(() => setupFaro()).not.toThrow();
  });
});

function exceptionItem(type: string, value: string): TransportItem<APIEvent> {
  return {
    type: 'exception',
    payload: { timestamp: new Date().toISOString(), type, value, stacktrace: { frames: [] } },
    meta: {},
  } as unknown as TransportItem<APIEvent>;
}

describe('scrub', () => {
  // The browser is the easiest place in this system to send content by
  // accident, because a caught error's message is very often a response body.
  // This is the same leak that `safeError` closes on the server side, arriving
  // by a different route.
  it('withholds a JSON parse message, which quotes the content being parsed', () => {
    let raw = '';
    try {
      JSON.parse('{"name": Sunday Roast Potatoes}');
    } catch (e) {
      raw = (e as Error).message;
    }
    // Guard the premise: if V8 stops quoting the input, this whole scrub is
    // pointless and this test failing is how we find out.
    expect(raw).toContain('Sunday Roa');

    const item = scrub(exceptionItem('SyntaxError', raw));
    const payload = item?.payload as { value?: string };

    expect(payload.value).not.toContain('Sunday Roa');
    expect(payload.value).toContain('ADR-0008');
  });

  // The frames are the whole reason Phase 5 uploads source maps. Scrubbing the
  // message must not take them with it.
  it('keeps the stack trace, which is what the source maps de-minify', () => {
    const item = scrub(exceptionItem('SyntaxError', 'Unexpected token, "a recipe name"'));
    const payload = item?.payload as { stacktrace?: unknown };

    expect(payload.stacktrace).toBeDefined();
  });

  it('leaves an ordinary error untouched', () => {
    const item = scrub(exceptionItem('TypeError', 'x is not a function'));
    const payload = item?.payload as { value?: string };

    expect(payload.value).toBe('x is not a function');
  });

  it('passes through a payload it does not recognise', () => {
    const measurement = { type: 'measurement', payload: { values: { lcp: 1200 } }, meta: {} };

    expect(scrub(measurement as unknown as TransportItem<APIEvent>)).toBe(measurement);
  });
});

describe('APP_NAME', () => {
  // Three things must agree on this string or stack traces stay minified with
  // nothing reporting a problem: the runtime config, the bundle id injected
  // into the built chunks, and the upload. The shell script cannot import this
  // constant, so the agreement is asserted here instead.
  it('matches the app name scripts/upload-sourcemaps.sh uses', async () => {
    const { readFile } = await import('node:fs/promises');
    // From cwd rather than import.meta.url: these tests run under jsdom, where
    // import.meta.url is not a file: URL and readFile rejects it.
    const script = await readFile('scripts/upload-sourcemaps.sh', 'utf8');

    expect(script).toContain(`APP_NAME="${APP_NAME}"`);
  });

  it('follows ADR-0007 naming, so one query reaches every runtime', () => {
    expect(APP_NAME).toBe('bigshop-browser');
  });
});
