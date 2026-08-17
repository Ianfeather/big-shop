import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The gate itself. The property worth the most here is a negative one -
// declining produces no tag, no requests and no cookies - and a negative is
// exactly what a passing feature silently stops guaranteeing.

async function loadGa(measurementId?: string) {
  vi.resetModules();
  if (measurementId) {
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', measurementId);
  } else {
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', '');
  }
  return import('./ga');
}

function scriptTags() {
  return Array.from(document.querySelectorAll('script')).map(s => s.src);
}

beforeEach(() => {
  document.head.innerHTML = '';
  delete (window as { dataLayer?: unknown[] }).dataLayer;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('without a measurement id', () => {
  it('is disabled and loads nothing', async () => {
    const ga = await loadGa();

    expect(ga.enabled()).toBe(false);
    ga.start();

    expect(scriptTags()).toHaveLength(0);
    expect(window.dataLayer).toBeUndefined();
  });

  // The Faro precedent: a build without the variable makes no requests at all,
  // so a deploy preview or a laptop cannot pollute production's numbers.
  it('reports nothing even when asked to', async () => {
    const ga = await loadGa();
    ga.start();
    ga.trackPageView('/list', 'Shopping list');
    ga.setAccount(1);

    expect(window.dataLayer).toBeUndefined();
  });
});

describe('with a measurement id', () => {
  it('loads the tag exactly once, however often start is called', async () => {
    const ga = await loadGa('G-TEST123');

    ga.start();
    ga.start();
    ga.start();

    const googleScripts = scriptTags().filter(src => src.includes('googletagmanager.com'));
    expect(googleScripts).toHaveLength(1);
    expect(googleScripts[0]).toContain('id=G-TEST123');
  });

  // Ordering is the part that is easy to get wrong and impossible to see: gtag
  // applies whatever consent state is already queued when it initialises, so a
  // `default` pushed after `config` would have gated nothing.
  it('queues denied defaults before anything else', async () => {
    const ga = await loadGa('G-TEST123');
    ga.start();

    const calls = (window.dataLayer as IArguments[]).map(args => Array.from(args));
    expect(calls[0][0]).toBe('consent');
    expect(calls[0][1]).toBe('default');
    expect(calls[0][2]).toMatchObject({ analytics_storage: 'denied' });

    const configIndex = calls.findIndex(c => c[0] === 'config');
    expect(configIndex).toBeGreaterThan(0);
  });

  // Big Shop runs no ads. Granting these "for completeness" alongside the
  // analytics signal is the drift this pins shut.
  it('never grants any advertising signal', async () => {
    const ga = await loadGa('G-TEST123');
    ga.start();
    ga.trackPageView('/', 'Home');
    ga.setAccount(7);

    const consentPayloads = (window.dataLayer as IArguments[])
      .map(args => Array.from(args))
      .filter(c => c[0] === 'consent')
      .map(c => c[2] as Record<string, string>);

    consentPayloads.forEach(payload => {
      ['ad_storage', 'ad_user_data', 'ad_personalization'].forEach(signal => {
        if (signal in payload) expect(payload[signal]).toBe('denied');
      });
    });
  });

  it('turns page views off on the tag so they can be fired by hand', async () => {
    const ga = await loadGa('G-TEST123');
    ga.start();

    const config = (window.dataLayer as IArguments[])
      .map(args => Array.from(args))
      .find(c => c[0] === 'config');

    expect(config?.[2]).toMatchObject({ send_page_view: false });
  });

  it('sends the account as a user property and never as user_id', async () => {
    const ga = await loadGa('G-TEST123');
    ga.start();
    ga.setAccount(42);

    const calls = (window.dataLayer as IArguments[]).map(args => Array.from(args));
    const set = calls.find(c => c[0] === 'set');
    expect(set?.[2]).toEqual({ account_id: '42' });

    // The rule ADR-0008's amendment states: Google is never told who someone
    // is, only which Account they are acting for.
    const serialised = JSON.stringify(calls);
    expect(serialised).not.toContain('user_id');
    expect(serialised).not.toContain('auth0|');
  });

  it('says nothing about an account it does not have', async () => {
    const ga = await loadGa('G-TEST123');
    ga.start();
    ga.setAccount(undefined);

    const calls = (window.dataLayer as IArguments[]).map(args => Array.from(args));
    expect(calls.find(c => c[0] === 'set')).toBeUndefined();
  });

  it('reports a page view with the title it was given, not document.title', async () => {
    document.title = 'Ragù alla Bolognese — Big Shop';
    const ga = await loadGa('G-TEST123');
    ga.start();
    ga.trackPageView('/recipes/12', 'Recipe');

    const view = (window.dataLayer as IArguments[])
      .map(args => Array.from(args))
      .find(c => c[0] === 'event' && c[1] === 'page_view');

    expect(view?.[2]).toMatchObject({ page_path: '/recipes/12', page_title: 'Recipe' });
    expect(JSON.stringify(view)).not.toContain('Ragù');
  });

  // Withdrawal has to mean the thing it says: signalling denial while leaving
  // the client id on the device is the common half-implementation.
  it('signals denial and clears the GA cookies on stop', async () => {
    const ga = await loadGa('G-TEST123');
    ga.start();

    document.cookie = '_ga=GA1.1.12345.67890; path=/';
    document.cookie = '_ga_TEST123=GS1.1.abcdef; path=/';
    expect(document.cookie).toContain('_ga');

    ga.stop();

    const calls = (window.dataLayer as IArguments[]).map(args => Array.from(args));
    const last = calls.filter(c => c[0] === 'consent').pop();
    expect(last?.[2]).toMatchObject({ analytics_storage: 'denied' });

    expect(document.cookie).not.toContain('_ga=');
    expect(document.cookie).not.toContain('_ga_TEST123');
  });

  it('does not throw when stopping before anything started', async () => {
    const ga = await loadGa('G-TEST123');
    expect(() => ga.stop()).not.toThrow();
  });

  // The half of withdrawal that the cookie sweep hides: gtag.js is still in the
  // page and will happily send cookieless hits, so gating reporting on "the tag
  // is loaded" keeps talking to Google after someone has said stop.
  it('sends nothing more once consent is withdrawn', async () => {
    const ga = await loadGa('G-TEST123');
    ga.start();
    ga.stop();

    const before = (window.dataLayer as IArguments[]).length;
    ga.trackPageView('/list', 'Shopping list');
    ga.setAccount(9);

    expect((window.dataLayer as IArguments[]).length).toBe(before);
  });

  // The other direction, and the one nobody would notice: changing your mind
  // back within the same visit has to start collection again, not silently
  // leave it off until the next reload.
  it('collects again when consent is re-granted in the same visit', async () => {
    const ga = await loadGa('G-TEST123');
    ga.start();
    ga.stop();
    ga.start();

    const calls = (window.dataLayer as IArguments[]).map(args => Array.from(args));
    expect(calls.filter(c => c[0] === 'consent').pop()?.[2]).toMatchObject({
      analytics_storage: 'granted',
    });

    ga.trackPageView('/list', 'Shopping list');
    expect(
      calls.length < (window.dataLayer as IArguments[]).length
    ).toBe(true);

    // ...and without a second copy of the tag.
    expect(scriptTags().filter(src => src.includes('googletagmanager.com'))).toHaveLength(1);
  });

  // The race this pins shut: an already-loaded gtag.js can write `_ga`
  // asynchronously, so a withdrawal that sweeps once can lose to a write the
  // tag had already begun. Seen in a browser - one run cleared, the next did
  // not, with nothing different in the code.
  it('sweeps the cookies again after the tag has settled', async () => {
    vi.useFakeTimers();
    const ga = await loadGa('G-TEST123');
    ga.start();
    ga.stop();

    // The tag gets its write in after the first sweep.
    document.cookie = '_ga=GA1.1.written.late; path=/';
    expect(document.cookie).toContain('_ga=');

    vi.advanceTimersByTime(1000);

    expect(document.cookie).not.toContain('_ga=');
    vi.useRealTimers();
  });
});
