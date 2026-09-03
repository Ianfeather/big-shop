package service

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// countingLoader stands in for the two catalog queries. What the cache is for
// is *not* loading, so the number of loads is the assertion in almost every
// test here.
func countingLoader(loads *atomic.Int32, units UnitCatalog) func(context.Context, *sql.DB) (UnitCatalog, IngredientCatalog, error) {
	return func(context.Context, *sql.DB) (UnitCatalog, IngredientCatalog, error) {
		loads.Add(1)
		return units, IngredientCatalog{}, nil
	}
}

func TestCatalogsLoadOnceAndAreServedFromMemory(t *testing.T) {
	var loads atomic.Int32
	c := &Catalogs{load: countingLoader(&loads, UnitCatalog{"gram": {Kind: KindWeight, Factor: 1}})}

	for i := 0; i < 5; i++ {
		units, _, err := c.Get(context.Background(), nil)
		if err != nil {
			t.Fatalf("Get: %v", err)
		}
		if got := units.Get("gram").Factor; got != 1 {
			t.Fatalf("gram factor = %v, want 1", got)
		}
	}

	if got := loads.Load(); got != 1 {
		t.Errorf("loaded %d times, want 1 - the other four reads should not have touched the database", got)
	}
}

// The point of the cache is that a Recipe save is what makes it wrong, so a
// Recipe save is what has to clear it. Without this, a Unit coined by an import
// ("bunch") would not combine on the Shopping List until the TTL expired.
func TestInvalidateForcesAReload(t *testing.T) {
	var loads atomic.Int32
	c := &Catalogs{load: countingLoader(&loads, UnitCatalog{})}

	if _, _, err := c.Get(context.Background(), nil); err != nil {
		t.Fatalf("Get: %v", err)
	}
	c.Invalidate()
	if _, _, err := c.Get(context.Background(), nil); err != nil {
		t.Fatalf("Get after Invalidate: %v", err)
	}

	if got := loads.Load(); got != 2 {
		t.Errorf("loaded %d times, want 2", got)
	}
}

// The TTL is the backstop for writes that never reach this process at all - a
// migration, a hand-edit in the TiDB console, scripts/sync-from-prod.sh.
func TestCatalogsReloadOnceTheTTLHasPassed(t *testing.T) {
	var loads atomic.Int32
	c := &Catalogs{load: countingLoader(&loads, UnitCatalog{})}

	if _, _, err := c.Get(context.Background(), nil); err != nil {
		t.Fatalf("Get: %v", err)
	}
	// Reaching in beats sleeping for the real TTL, and asserts on the boundary
	// the code actually tests rather than on the clock.
	c.mu.Lock()
	c.loadedAt = time.Now().Add(-catalogTTL - time.Second)
	c.mu.Unlock()

	if _, _, err := c.Get(context.Background(), nil); err != nil {
		t.Fatalf("Get after TTL: %v", err)
	}
	if got := loads.Load(); got != 2 {
		t.Errorf("loaded %d times, want 2", got)
	}
}

// A failed load must not be cached, or one blip leaves the API combining
// against an empty catalog until something invalidates it - and an empty
// catalog is not an error the aggregation can detect. It silently degrades
// every Amount to "no Unit Size known", which reads as a data problem.
func TestAFailedLoadIsNotCached(t *testing.T) {
	var loads atomic.Int32
	boom := errors.New("catalog unavailable")
	c := &Catalogs{load: func(context.Context, *sql.DB) (UnitCatalog, IngredientCatalog, error) {
		if loads.Add(1) == 1 {
			return nil, nil, boom
		}
		return UnitCatalog{"gram": {Kind: KindWeight, Factor: 1}}, IngredientCatalog{}, nil
	}}

	if _, _, err := c.Get(context.Background(), nil); !errors.Is(err, boom) {
		t.Fatalf("first Get error = %v, want %v", err, boom)
	}
	units, _, err := c.Get(context.Background(), nil)
	if err != nil {
		t.Fatalf("second Get: %v", err)
	}
	if got := units.Get("gram").Factor; got != 1 {
		t.Errorf("gram factor = %v, want 1 - the retry should have served the real catalog", got)
	}
}

// GetShoppingList and GenerateShoppingList now read the catalogs from an
// errgroup goroutine, so concurrent Gets are the normal case rather than an
// exotic one. Run under -race (as CI does), this is the test that a shared
// cache did not quietly become a shared data race.
func TestConcurrentGetsLoadOnce(t *testing.T) {
	var loads atomic.Int32
	c := &Catalogs{load: func(context.Context, *sql.DB) (UnitCatalog, IngredientCatalog, error) {
		loads.Add(1)
		// Long enough that every goroutine is genuinely waiting on this one
		// rather than arriving after it finished.
		time.Sleep(10 * time.Millisecond)
		return UnitCatalog{"gram": {Kind: KindWeight, Factor: 1}}, IngredientCatalog{}, nil
	}}

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			units, _, err := c.Get(context.Background(), nil)
			if err != nil {
				t.Errorf("Get: %v", err)
				return
			}
			if got := units.Get("gram").Factor; got != 1 {
				t.Errorf("gram factor = %v, want 1", got)
			}
		}()
	}
	wg.Wait()

	if got := loads.Load(); got != 1 {
		t.Errorf("loaded %d times, want 1 - twenty concurrent misses should share one load", got)
	}
}

// A nil *Catalogs is a valid uncached cache, so an App assembled without one -
// which app_test.go does, and which any future caller might - invalidates
// harmlessly rather than panicking on a code path that only runs after a
// successful write.
//
// Only Invalidate is asserted here. Get's nil path falls through to a real
// query, which needs a real database and so belongs to the e2e suite.
func TestNilCatalogsInvalidatesHarmlessly(t *testing.T) {
	var c *Catalogs
	c.Invalidate()
}
