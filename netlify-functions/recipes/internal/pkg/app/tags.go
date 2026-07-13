package app

import (
	"context"
	"log"
	"net/http"

	"recipes/internal/pkg/service"

	"github.com/danielgtaylor/huma/v2"
)

// TagsOutput is the response body for listing tags.
type TagsOutput struct {
	Body []string
}

func (a *App) getTags(ctx context.Context, _ *struct{}) (*TagsOutput, error) {
	tags, err := service.GetAllTags(a.db)

	if err != nil {
		log.Println(err)
		return nil, huma.Error500InternalServerError("Failed to get tags from db")
	}

	return &TagsOutput{Body: tags}, nil
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
