package service

import (
	"context"
	"database/sql"
	"sync"
	"time"
)

// catalogTTL is the backstop on the in-process catalog cache.
//
// Invalidation on write is the mechanism; this is the safety net for the writes
// that do not go through this process at all - a migration, a hand-edit in the
// TiDB console, scripts/sync-from-prod.sh. Without it, a catalog changed
// underneath the API is stale until the container restarts, which on Fly can be
// days. Five minutes matches the s-maxage ADR-0009 put on /units, so the two
// caches over the same data have the same worst case.
const catalogTTL = 5 * time.Minute

// Catalogs holds the Unit and Ingredient catalogs in process.
//
// Both are *global* - not scoped to an Account - and they were re-read from the
// database on every shopping-list request, three round trips a time, loading
// the entire catalog. That cost grows with the catalog rather than with the
// user's list, which is the wrong slope: adding Recipes to Big Shop made
// reading a Shopping List slower for everyone.
//
// Caching them in process is only correct because ADR-0006 made this a single
// long-lived server. On Lambda every warm container held its own copy, so an
// invalidation could only ever clear the one container that happened to serve
// the write, and the rest went on serving a stale catalog - which is why this
// was not worth doing before and is now.
//
// This is a *different* cache from the one #44/ADR-0009 put in front of
// GET /units at Netlify's edge. That one serves clients; this one serves the
// API's own combining logic. A Recipe save must clear both, so both hang off
// the same call site in the recipe handlers - see app.purgeUnitsCache.
//
// Safe for concurrent use. A miss is served under the write lock rather than by
// racing loaders: it costs a little reader latency on exactly one request per
// TTL, and in exchange a burst of concurrent requests after an invalidation
// issues one catalog load between them rather than one each.
//
// **The catalogs handed out are the cached maps themselves, not copies.**
// Nothing mutates them today - CombineIngredients, ApplyDisplayUnits,
// MarkPantryStaples and RoundAmountsForShopping all read the catalogs and write
// only to the list items - and nothing must start to, because a write would
// corrupt the copy every later request reads. Copying defensively on every read
// would undo most of what the cache is for.
type Catalogs struct {
	mu          sync.RWMutex
	units       UnitCatalog
	ingredients IngredientCatalog
	loadedAt    time.Time
	// load is loadCatalogs, swapped out by tests. Kept as a field rather than
	// letting tests reach for a database because a cache's interesting
	// behaviour - how many times it loads, and when - is invisible from the
	// outside otherwise, and that is the whole of what there is to get wrong
	// here. Same reasoning as app.cachePurger.
	load func(context.Context, *sql.DB) (UnitCatalog, IngredientCatalog, error)
}

// NewCatalogs returns an empty cache; the first Get fills it.
func NewCatalogs() *Catalogs {
	return &Catalogs{load: loadCatalogs}
}

// Get returns both catalogs, loading them if the cache is empty or the TTL has
// passed.
//
// A nil *Catalogs is a valid, uncached cache: it loads on every call. That
// keeps any caller that has not been given one - a test, a future command -
// correct rather than panicking, and makes caching genuinely optional rather
// than something every call site has to arrange.
//
// The two are returned together, and loaded together, because
// GetIngredientCatalog needs the Unit catalog to sanity-check a Base Unit.
// Handing back a cached pair also means the aggregation cannot see a Unit
// catalog from one moment and an Ingredient catalog from another.
func (c *Catalogs) Get(ctx context.Context, db *sql.DB) (UnitCatalog, IngredientCatalog, error) {
	if c == nil {
		return loadCatalogs(ctx, db)
	}

	c.mu.RLock()
	units, ingredients, fresh := c.units, c.ingredients, c.fresh()
	c.mu.RUnlock()
	if fresh {
		return units, ingredients, nil
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	// Someone else may have loaded while this goroutine waited for the lock.
	if c.fresh() {
		return c.units, c.ingredients, nil
	}

	loader := c.load
	if loader == nil {
		// A Catalogs built as a bare &Catalogs{} rather than by NewCatalogs
		// still works, instead of panicking on a nil func.
		loader = loadCatalogs
	}
	units, ingredients, err := loader(ctx, db)
	if err != nil {
		// Deliberately leaves the previous contents in place rather than
		// blanking them. They are already known to be stale-or-empty, and an
		// empty catalog is not an error state the aggregation can detect - it
		// silently degrades every Amount to "no Unit Size known". Better to keep
		// serving the last good answer and retry on the next request.
		return nil, nil, err
	}
	c.units, c.ingredients, c.loadedAt = units, ingredients, time.Now()
	return units, ingredients, nil
}

// fresh reports whether the cached pair is loaded and inside the TTL. Callers
// hold the lock.
func (c *Catalogs) fresh() bool {
	return c.units != nil && time.Since(c.loadedAt) < catalogTTL
}

// Invalidate drops the cached catalogs, so the next read reloads them.
//
// Called after a Recipe create or edit, which are the only writes to `unit` and
// `ingredient` this process makes: insertUnits and insertIngredients upsert
// every Unit and Ingredient a Recipe references, and classifyNewIngredients
// then writes Base Units, Display Units, pantry flags and Unit Sizes. Delete is
// deliberately not wired, for the same reason the edge purge is not: it removes
// a Recipe's parts, never a Unit or an Ingredient.
//
// Nil-safe, matching Get.
func (c *Catalogs) Invalidate() {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.units, c.ingredients, c.loadedAt = nil, nil, time.Time{}
	c.mu.Unlock()
}

// loadCatalogs reads both catalogs from the database, in the order the second
// one requires.
func loadCatalogs(ctx context.Context, db *sql.DB) (UnitCatalog, IngredientCatalog, error) {
	units, err := GetUnitCatalog(ctx, db)
	if err != nil {
		return nil, nil, err
	}
	ingredients, err := GetIngredientCatalog(ctx, db, units)
	if err != nil {
		return nil, nil, err
	}
	return units, ingredients, nil
}
