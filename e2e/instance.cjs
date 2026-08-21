// The identity of one e2e stack: its docker compose project name and the three
// ports it binds. Everything is derived here, once, so that the port Playwright
// talks to and the port the stack actually binds are the same number by
// construction rather than by two files agreeing.
//
// Why it is derived rather than pinned to literals: several agents work this
// repo in parallel git worktrees, and a fixed project name means every worktree
// resolves to the *same* containers and volumes. `npm run test:e2e` begins with
// `test:e2e:stop` (`docker compose down --volumes`), so starting a run in one
// worktree tore down another's in-flight run, database included, mid-suite -
// invisibly from the other side, and looking exactly like an application bug.
//
// Deriving from the worktree path makes that automatic: no per-agent convention
// to remember, which matters because the failure it prevents is silent and a
// convention would not be.
//
// Plain CommonJS rather than TypeScript because the consumers are split across
// two runtimes: `e2e/env.ts` (via Playwright's own TS pipeline, which emits
// CJS) and shell - `scripts/e2e-compose.sh` runs this file with `node` to get
// the project name for a `docker compose` invocation. A .cjs file is the one
// shape both load without depending on Node's type-stripping or `require(esm)`.

const { createHash } = require('node:crypto');
const path = require('node:path');

// This file lives in `e2e/`, so the worktree root is one level up. Resolved
// from __dirname rather than process.cwd() so the answer does not depend on
// where the caller was invoked from.
const worktreeRoot = path.resolve(__dirname, '..');

// An explicit E2E_INSTANCE wins, for the case where two worktrees happen to
// land on the same port offset (docker compose fails loudly on the port
// clash - see scripts/dev-full.sh's strict mode - and this is the way out).
const instanceKey = (process.env.E2E_INSTANCE || '').trim() || worktreeRoot;
const digest = createHash('sha256').update(instanceKey).digest();

// 0-99. Each port family below gets its own block of 100, so a given offset
// picks one port from each and no two families can ever overlap.
const offset = digest.readUInt16BE(0) % 100;

/**
 * A readable label for the instance, so `docker compose ls` says whose stack a
 * set of containers is without anyone having to `docker inspect` the mounts.
 *
 * The last two path segments, because every worktree of this repo is checked
 * out into a directory named `big-shop` - the segment above it is the only part
 * that differs (`.../4/big-shop` -> `4-big-shop`).
 */
function label() {
  if (process.env.E2E_INSTANCE) {
    return slugify(process.env.E2E_INSTANCE).slice(0, 24);
  }
  const tail = worktreeRoot.split(path.sep).filter(Boolean).slice(-2).join('-');
  // The digest suffix is what actually guarantees uniqueness; the slug is only
  // there to be read.
  return `${slugify(tail).slice(0, 24)}-${digest.toString('hex').slice(0, 6)}`;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Port blocks deliberately distinct from scripts/dev-full.sh's own defaults
// (3000/8080/3308), so a manually-running `npm run dev:full` in the same
// worktree doesn't collide with the stack Playwright starts for e2e.
const WEB_PORT = 3900 + offset; // 3900-3999
const DB_PORT = 4200 + offset; //  4200-4299, clear of 4317/4318 (OTLP)
const API_PORT = 8980 + offset; // 8980-9079

module.exports = {
  COMPOSE_PROJECT_NAME: `bigshop-e2e-${label()}`,
  WEB_PORT,
  DB_PORT,
  API_PORT,
};

// Also usable as a CLI, which is how the shell consumers read these values:
//   node e2e/instance.cjs COMPOSE_PROJECT_NAME
// With no argument it prints every value as KEY=value lines.
if (require.main === module) {
  const [, , key] = process.argv;
  if (key) {
    if (!(key in module.exports)) {
      console.error(`Unknown e2e instance key: ${key}`);
      process.exit(1);
    }
    console.log(String(module.exports[key]));
  } else {
    for (const [k, v] of Object.entries(module.exports)) console.log(`${k}=${v}`);
  }
}
