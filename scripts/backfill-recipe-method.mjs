#!/usr/bin/env node
// Backfill `recipe`.`method` for Recipes that were imported from a URL, by
// re-reading each Recipe's own remote_url through the app's URL Import path and
// keeping the method it extracts. Writes a SQL file; touches no database.
// Resolves follow-ups.md #41 for the Recipes that have a source to re-read.
//
// Usage (with the local stack running - `npm run dev:full`):
//
//   scripts/backfill-recipe-method.mjs --limit 3      # try a few first
//   scripts/backfill-recipe-method.mjs                # the full run
//
//   --out <path>    where to write the SQL (default: the next migrations/ number)
//   --limit <n>     only attempt the first n candidates, by id
//   --id <a,b,c>    only attempt these Recipe ids (for retrying individual ones)
//   --web <url>     Next.js origin       (default $NEXT_PUBLIC_HOST or :3000)
//   --api <url>     Go API base          (default $NEXT_PUBLIC_API_HOST or :8080/...)
//   --delay <ms>    pause between pages  (default 1000)
//
// **Run it against a freshly synced copy of production**
// (`scripts/sync-from-prod.sh`). The SQL it writes targets rows by the id it
// read locally, and that is only production's id because the sync carries
// production's ids verbatim. The generated statements defend themselves against
// this being wrong anyway - see the header they carry - but a stale local copy
// still means re-reading pages for Recipes that no longer need it.
//
// It drives /api/parse-recipe-url rather than importing lib/recipe-import
// directly. That is the whole point: the backfill reads pages through exactly
// the code path the app uses, including the JSON-LD preference and the "no
// ingredients means the page was not read" guard added for #40, rather than a
// second extraction that could drift from it. It also means no OpenAI wiring
// here - the running app already has the key.
//
// Only the method is kept. Everything else the extraction returns is discarded
// unread, which is what makes this safe to run at all: #41's worst case was a
// re-import quietly replacing good ingredients with nothing, and a script that
// cannot write an ingredient cannot do that.
import { writeFileSync, appendFileSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { delay: 1000 };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    const value = argv[i + 1];
    if (!key || value === undefined) usage(`Missing a value for --${key}`);
    if (!['out', 'limit', 'id', 'web', 'api', 'delay'].includes(key)) usage(`Unknown option --${key}`);
    args[key] = value;
  }
  return args;
}

function usage(message) {
  console.error(`${message}\n\nSee the comment at the top of ${'scripts/backfill-recipe-method.mjs'} for usage.`);
  process.exit(1);
}

// The next free migrations/ number. This is a change applied to production, and
// migrations/ is where this repo keeps the record of those - 022, 023 and 029
// are all data rather than schema. It matches nothing when it runs on a fresh
// local database (no rows exist yet), exactly like those.
function nextMigrationPath() {
  const dir = join(repoRoot, 'migrations');
  const highest = readdirSync(dir)
    .map((name) => Number(name.slice(0, 3)))
    .filter((n) => !Number.isNaN(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return join(dir, `${String(highest + 1).padStart(3, '0')}_backfill_recipe_method.sql`);
}

// Doubles the quote rather than backslash-escaping it: '' is a single-quote in
// every SQL mode, where \' depends on NO_BACKSLASH_ESCAPES being off.
function sqlString(value) {
  return `'${value.replace(/\0/g, '').replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

// Anything interpolated into a `-- ` comment line has to stay on that line: a
// newline in a Recipe name or an error message would leave the rest of it
// sitting in the file as SQL.
function comment(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function isFetchableUrl(value) {
  // remote_url is a free-text varchar and some Recipes use it to record a
  // cookbook ("From the Pie Room cookbook"). Those have no page to re-read.
  try {
    return ['http:', 'https:'].includes(new URL(value ?? '').protocol);
  } catch {
    return false;
  }
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed with status ${res.status}`);
  return res.json();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const web = (args.web || process.env.NEXT_PUBLIC_HOST || 'http://localhost:3000').replace(/\/$/, '');
  const api = (args.api || process.env.NEXT_PUBLIC_API_HOST || 'http://localhost:8080/.netlify/functions/recipes').replace(/\/$/, '');
  const out = args.out ? resolve(args.out) : nextMigrationPath();
  const delay = Number(args.delay);

  let summaries;
  try {
    summaries = await getJson(`${api}/recipes`);
  } catch (e) {
    usage(`Could not reach the Go API at ${api} (${e.message}).\nStart the stack with \`npm run dev:full\`, and pass --api/--web if it chose other ports.`);
  }

  console.error(`Reading ${summaries.length} Recipes from ${api}...`);
  const recipes = [];
  for (const { id } of summaries) recipes.push(await getJson(`${api}/recipe/${id}`));

  const wanted = args.id ? new Set(args.id.split(',').map((s) => Number(s.trim()))) : null;
  const missingMethod = recipes.filter((r) => !r.method?.trim());
  const noSource = missingMethod.filter((r) => !isFetchableUrl(r.remoteUrl));
  let candidates = missingMethod
    .filter((r) => isFetchableUrl(r.remoteUrl))
    .sort((a, b) => a.id - b.id)
    .filter((r) => !wanted || wanted.has(r.id));
  if (args.limit) candidates = candidates.slice(0, Number(args.limit));

  console.error(
    `${missingMethod.length} of ${recipes.length} Recipes have no method. ` +
      `${candidates.length} will be re-read; ${noSource.length} have no URL to re-read.`
  );

  // Written as it goes rather than at the end, so an interrupted run still
  // leaves a usable file. Every statement stands alone and is guarded, so a
  // truncated file is as safe to apply as a complete one - which is also why
  // there is no enclosing transaction to be left unclosed.
  writeFileSync(out, header(api));

  const applied = [];
  const skipped = [];
  for (const [index, recipe] of candidates.entries()) {
    process.stderr.write(`[${index + 1}/${candidates.length}] ${recipe.name} ... `);
    try {
      const res = await fetch(`${web}/api/parse-recipe-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: recipe.remoteUrl }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        // 422 is the import telling us it could not read the page at all -
        // dead link, paywall, bot protection. Anything else is a real failure.
        skipped.push({ recipe, reason: body.error || `HTTP ${res.status}` });
        console.error(`skipped (${res.status})`);
      } else if (!body.method?.trim()) {
        skipped.push({ recipe, reason: 'the page was read but carries no method' });
        console.error('skipped (no method on the page)');
      } else {
        const method = body.method.replace(/\r\n/g, '\n').trim();
        appendFileSync(out, statement(recipe, method));
        applied.push(recipe);
        console.error(`ok (${method.length} chars)`);
      }
    } catch (e) {
      skipped.push({ recipe, reason: e.message });
      console.error(`failed (${e.message})`);
    }

    if (index < candidates.length - 1 && delay) await new Promise((r) => setTimeout(r, delay));
  }

  appendFileSync(out, footer({ applied, skipped, noSource, recipes, missingMethod }));

  console.error(`\n${applied.length} methods written, ${skipped.length} skipped.`);
  console.error(`SQL written to ${out.replace(`${repoRoot}/`, '')}`);
}

function header(api) {
  return `-- Backfill \`recipe\`.\`method\` for Recipes imported from a URL.
--
-- Generated by scripts/backfill-recipe-method.mjs on ${new Date().toISOString().slice(0, 10)}
-- against ${api}
-- by re-reading each Recipe's own remote_url through the app's URL Import path
-- and keeping only the method. Resolves follow-ups.md #41 for the Recipes that
-- have a source to re-read. Counts, and every skip with its reason, are at the
-- foot of this file.
--
-- Safe to apply more than once, and safe to apply to a database that has moved
-- on since this was generated. Every statement below:
--
--   * writes \`method\` and nothing else. Ingredients, name and tags are never
--     touched, so a page that re-read thinly cannot damage good data - #41's
--     worst case;
--   * requires \`remote_url\` still to match the page the method was read from,
--     so a Recipe whose id has shifted is a no-op rather than a wrong write;
--   * requires \`method\` still to be empty, so a method written by hand since
--     this file was generated is never overwritten.
--
-- Deliberately not wrapped in a transaction: each statement is independent and
-- self-guarding, so a partially written or partially applied file is still
-- correct. Re-run the generator to pick up whatever is still missing.
--
-- Pure DML. Unlike 027 this file is not endangered by \`mysql --force\`, since
-- every statement stands alone - a skipped one costs one method and nothing
-- else. It is applied that way locally, in fact: docker/mysql-init runs every
-- migrations/*.sql with --force, and this one matches no rows there at all
-- because migrations run against an empty database. Against production, apply
-- it without --force, so that a failure is visible rather than skipped.

-- Method text is full of degree signs, accents and dashes, and a mysql client
-- whose default character set is latin1 will read these UTF-8 bytes as latin1
-- and store them double-encoded - "180°C" arriving as "180Â°C" - without
-- erroring. Declaring the encoding here rather than relying on how the file
-- happens to be piped in is what stops that.
SET NAMES utf8mb4;

`;
}

function statement(recipe, method) {
  return `-- ${recipe.id}  ${comment(recipe.name)}
--     ${comment(recipe.remoteUrl)}
UPDATE \`recipe\` SET \`method\` = ${sqlString(method)}
WHERE \`id\` = ${recipe.id}
  AND \`remote_url\` = ${sqlString(recipe.remoteUrl)}
  AND (\`method\` IS NULL OR TRIM(\`method\`) = '');

`;
}

function footer({ applied, skipped, noSource, recipes, missingMethod }) {
  const were = (n) => (n === 1 ? 'was' : 'were');
  const have = (n) => (n === 1 ? 'has' : 'have');
  const lines = [
    `-- ${missingMethod.length} of ${recipes.length} Recipes had no method.`,
    `-- ${applied.length} ${were(applied.length)} backfilled above.`,
    `-- ${skipped.length} ${were(skipped.length)} re-read and could not be used:`,
    ...skipped.map(({ recipe, reason }) => `--   ${recipe.id}  ${comment(recipe.name)} - ${comment(reason)}`),
    `-- ${noSource.length} ${have(noSource.length)} no URL to re-read, and no source but the cook:`,
    ...noSource.map((recipe) => `--   ${recipe.id}  ${comment(recipe.name)}`),
    '',
    '-- Verification - expect no rows:',
    `-- SELECT id, name FROM \`recipe\` WHERE id IN (${applied.map((r) => r.id).join(', ') || '0'})`,
    "--   AND (method IS NULL OR TRIM(method) = '');",
    '',
  ];
  return `\n${lines.join('\n')}`;
}

main();
