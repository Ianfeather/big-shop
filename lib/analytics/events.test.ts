import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { daveTurn, inviteSent, recipeImported, shoppingListGenerated } from './events';

const trackEvent = vi.hoisted(() => vi.fn());
vi.mock('./ga', () => ({ trackEvent }));

beforeEach(() => {
  trackEvent.mockReset();
});

describe('events', () => {
  it('sends a recipe import with its source and nothing else', () => {
    recipeImported('url');
    expect(trackEvent).toHaveBeenCalledWith('recipe_imported', { source: 'url' });
  });

  it.each(['url', 'photo', 'text', 'manual'] as const)('accepts the %s source', (source) => {
    recipeImported(source);
    expect(trackEvent).toHaveBeenCalledWith('recipe_imported', { source });
  });

  it.each([
    [shoppingListGenerated, 'shopping_list_generated'],
    [daveTurn, 'dave_turn'],
    [inviteSent, 'invite_sent'],
  ] as const)('sends %o as a bare count', (fire, name) => {
    fire();
    // One argument, not two: a bare count carries no parameters at all rather
    // than an empty object.
    expect(trackEvent).toHaveBeenCalledWith(name);
  });
});

// The rules that keep this list short and content-free, asserted against the
// source rather than the behaviour - which is the only way to assert "nobody
// added a fifth one" or "nobody passed a Recipe name".
describe('the event list itself', () => {
  const source = readFileSync(join(__dirname, 'events.ts'), 'utf8');

  it('sends exactly the four events the spec fixed', () => {
    const names = [...source.matchAll(/trackEvent\('([a-z_]+)'/g)].map(m => m[1]);

    // If this fails, read lib/analytics/events.ts's rule before changing the
    // number: an event belongs here only when answering its question needs more
    // than Grafana's fourteen days of retention. Everything else is a metric.
    expect(names.sort()).toEqual([
      'dave_turn',
      'invite_sent',
      'recipe_imported',
      'shopping_list_generated',
    ]);
  });

  // Every parameter value must come from a closed set written in this file. A
  // parameter built from a variable is how a Recipe name reaches Google without
  // anyone deciding to send it - the same failure mode the page_title lookup
  // exists to prevent, at a different boundary.
  it('passes no free-text parameter', () => {
    const payloads = [...source.matchAll(/trackEvent\('[a-z_]+',([^;]*?)\);/g)]
      .map(m => m[1].trim())
      .filter(Boolean);

    expect(payloads.length).toBeGreaterThan(0);

    payloads.forEach(payload => {
      // Shorthand only - `{ source }`, whose value is the RecipeSource union, a
      // closed set declared above. Whitespace is normalised first rather than
      // matched, so reformatting this file cannot fail the rule; what must not
      // appear is a template literal, a property read, or a call, each of which
      // could carry something a user typed.
      expect(payload.replace(/\s+/g, '')).toBe('{source}');
      expect(payload).not.toContain('`');
      expect(payload).not.toMatch(/[.(]/);
    });
  });

  // The guarantee `ga.ts` claims for trackEvent, made real. Without this, a
  // fifth event added in a page would bypass both the four-event assertion and
  // the no-free-text one above, since they only read this file.
  it('is the only module that calls trackEvent', () => {
    const roots = ['components', 'pages', 'hooks', 'lib'];
    const callers: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          const text = readFileSync(full, 'utf8');
          if (/\btrackEvent\s*\(/.test(text)) callers.push(full);
        }
      }
    };

    const repoRoot = join(__dirname, '..', '..');
    roots.forEach(root => walk(join(repoRoot, root)));

    const outsiders = callers
      .map(f => f.slice(repoRoot.length + 1))
      .filter(f => f !== 'lib/analytics/events.ts' && f !== 'lib/analytics/ga.ts')
      .filter(f => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'));

    // If this fails: add a named function to lib/analytics/events.ts and call
    // that instead. The point is that every event name and every parameter
    // value stays readable in one file.
    expect(outsiders).toEqual([]);
  });

  it('does not mention anything that could be content', () => {
    const forbidden = ['recipe.name', 'recipeName', 'message', 'content', 'email', 'ingredient'];
    forbidden.forEach(term => {
      // Comments are allowed to discuss these - the rule is about what is sent -
      // so only the code lines are checked.
      const code = source
        .split('\n')
        .filter(line => !line.trim().startsWith('//'))
        .join('\n');
      expect(code).not.toContain(term);
    });
  });
});
