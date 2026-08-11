package app

import (
	"context"
	"log"
	"net/http"

	"recipes/internal/pkg/service"

	"github.com/danielgtaylor/huma/v2"
)

// unitsCacheControl overrides app.go's `private, no-store` default. Same
// reasoning as tagsCacheControl - global catalog, no account scoping, and the
// same accepted consequence that `public` makes it readable unauthenticated -
// but with a far shorter shared TTL, because unlike `tag` this catalog is Open:
// saving a Recipe upserts every Unit its ingredients reference (insertUnits in
// service/recipe.go), so an import can coin "bunch" at any moment.
//
// Five minutes is the *backstop*, not the intended freshness. The intended
// mechanism is UnitsCacheTag below, purged on write. The backstop exists
// because that purge is allowed to fail: it is best-effort, it is rate-limited
// to twice per five seconds per tag by Netlify, and it does nothing at all when
// the API is running unconfigured. Whatever the purge misses, this expires -
// which is why it is minutes rather than a year.
const unitsCacheControl = "public, max-age=0, s-maxage=300"

// UnitsCacheTag is the Netlify cache tag attached to /units responses, and the
// tag a Recipe write purges when it may have coined a Unit. Exported so the
// purger names it from here rather than repeating the literal: a purge of a tag
// no response carries is a silent no-op, with stale units and no error
// anywhere.
const UnitsCacheTag = "units"

// UnitsOutput is the response body for listing units.
type UnitsOutput struct {
	CacheControl string `header:"Cache-Control"`
	// Netlify-Cache-Tag rather than the vendor-neutral Cache-Tag: Netlify
	// prefers its own header when both are present, and there is no second CDN
	// in this path to serve (netlify.toml's /api/bigshop/* rewrite is the whole
	// story). It is also not visible to the browser, which the neutral one is.
	NetlifyCacheTag string `header:"Netlify-Cache-Tag"`
	Body            []service.Unit
}

// withCachePolicy stamps this route's policy onto the response.
//
// A method rather than two fields assigned at the return site so that a test
// can ask what /units actually emits without a database to reach the handler
// through. The mistake worth catching is a one-word one - `tagsCacheControl`
// pasted in here - and it has no symptom until a purge is missed, at which
// point the Open catalog is a day stale instead of five minutes.
func (o *UnitsOutput) withCachePolicy() *UnitsOutput {
	o.CacheControl = unitsCacheControl
	o.NetlifyCacheTag = UnitsCacheTag
	return o
}

func (a *App) getUnits(ctx context.Context, _ *struct{}) (*UnitsOutput, error) {
	units, err := service.GetAllUnits(ctx, a.db)

	if err != nil {
		log.Println(err)
		return nil, huma.Error500InternalServerError("Failed to get units from db")
	}

	// Success path only - Huma writes an output struct's headers only when it
	// has an output struct, so a 500 keeps app.go's safe default and a failed
	// read is neither cached nor tagged.
	return (&UnitsOutput{Body: units}).withCachePolicy(), nil
}

func (a *App) registerUnitsRoutes(api huma.API) {
	register(api, huma.Operation{
		OperationID: "list-units",
		Method:      http.MethodGet,
		Path:        "/units",
		Summary:     "List units",
		Description: "Returns every Unit an Ingredient Line's quantity can be expressed in.",
		Tags:        []string{"Units"},
	}, a.getUnits)
}
