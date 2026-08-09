package app

import (
	"context"
	"log"
	"net/http"

	"recipes/internal/pkg/service"

	"github.com/danielgtaylor/huma/v2"
)

// tagsCacheControl overrides app.go's `private, no-store` default.
//
// /tags takes no account scoping and returns the same bytes for every caller,
// and the `tag` table behind it is a fixed list seeded by migration that no
// code path writes to - saving a Recipe only writes the `recipe_tag` join rows
// (insertTags). hooks/use-tags.ts documents the same fact from the other side,
// as the reason nothing invalidates the client-side cache either. So this is
// the one catalog that needs no purge mechanism at all: a day is safe, and a
// new tag arrives with a migration and therefore a deploy.
//
// `max-age=0` deliberately: Huma emits no ETag, the browser has TanStack Query
// in front of this anyway, and a stale copy in a browser is one no purge could
// ever reach. It is the shared cache - `s-maxage`, Netlify's edge - that this
// is for.
//
// Accepted consequence, recorded in follow-ups.md #44: `public` makes this
// readable by an unauthenticated caller, because Authorization is not part of
// Netlify's cache key. Acceptable for a global, non-personal catalog
// (docs/adr/0001-global-ingredient-catalog.md) and for nothing else.
const tagsCacheControl = "public, max-age=0, s-maxage=86400"

// TagsOutput is the response body for listing tags.
type TagsOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         []string
}

// withCachePolicy stamps this route's policy onto the response. See the same
// method on UnitsOutput for why it is a method rather than a field assignment.
func (o *TagsOutput) withCachePolicy() *TagsOutput {
	o.CacheControl = tagsCacheControl
	return o
}

func (a *App) getTags(ctx context.Context, _ *struct{}) (*TagsOutput, error) {
	tags, err := service.GetAllTags(a.db)

	if err != nil {
		log.Println(err)
		return nil, huma.Error500InternalServerError("Failed to get tags from db")
	}

	// Success path only. An error returns before this, so the 500 keeps the
	// safe default rather than caching a failure for a day.
	return (&TagsOutput{Body: tags}).withCachePolicy(), nil
}

func (a *App) registerTagsRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-tags",
		Method:      http.MethodGet,
		Path:        "/tags",
		Summary:     "List tags",
		Description: "Returns every Tag name used by any Recipe, used for autosuggest.",
		Tags:        []string{"Tags"},
	}, a.getTags)
}
