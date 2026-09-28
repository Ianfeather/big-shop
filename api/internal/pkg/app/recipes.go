package app

import (
	"context"
	"net/http"
	"strings"
	"unicode/utf8"

	"recipes/internal/pkg/jev"
	"recipes/internal/pkg/service"
	"recipes/internal/pkg/telemetry"

	"github.com/danielgtaylor/huma/v2"
)

// RecipeSummary is service.Recipe under a distinct name: Huma's schema
// registry names components after the bare (package-less) Go type name, and
// that would otherwise collide with common.Recipe.
type RecipeSummary service.Recipe

// RecipesOutput is the response body for listing recipes.
type RecipesOutput struct {
	Body []RecipeSummary
}

func (a *App) getRecipes(ctx context.Context, _ *struct{}) (*RecipesOutput, error) {
	caller := callerFrom(ctx)
	recipes, err := service.GetAllRecipes(ctx, a.db, caller)

	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Failed to get recipes from db"), err)
	}

	summaries := make([]RecipeSummary, len(recipes))
	for i, r := range recipes {
		summaries[i] = RecipeSummary(r)
	}

	// A structural count, not content: how many Recipes came back is exactly the
	// kind of thing worth knowing when reconstructing a slow request afterwards,
	// and their names are exactly what ADR-0008 §1 says must not be here.
	//
	// InfoContext, not Info: the trace_id is read from the context, and a log
	// line without one still arrives in Loki but can no longer be tied to the
	// trace it belongs to.
	telemetry.Logger().InfoContext(ctx, "listed recipes", "recipe.count", len(summaries))

	return &RecipesOutput{Body: summaries}, nil
}

// SimilarRecipesInput is a search, and the Recipes it may be answered from.
type SimilarRecipesInput struct {
	Body struct {
		// Trimmed before use; the limits are checked again after trimming,
		// since "  cu " passes minLength here and is still a two-letter search.
		Query string `json:"query" minLength:"3" maxLength:"100" doc:"What the User typed. At least three characters once trimmed."`
		// The Recipes that passed the page's filters and did not exact-match.
		// The client already holds them; the server supplies their names.
		CandidateIDs []int `json:"candidateIds" minItems:"1" maxItems:"1000" doc:"Recipe ids to judge. Any not belonging to the caller's Account are ignored."`
	}
}

// SimilarRecipesOutput is the Similar Recipes found, most probable first.
type SimilarRecipesOutput struct {
	Body struct {
		Matches []service.SimilarMatch `json:"matches"`
	}
}

func (a *App) getSimilarRecipes(ctx context.Context, input *SimilarRecipesInput) (*SimilarRecipesOutput, error) {
	query := strings.TrimSpace(input.Body.Query)
	if utf8.RuneCountInString(query) < 3 {
		return nil, huma.Error422UnprocessableEntity("query must be at least three characters once trimmed")
	}

	caller := callerFrom(ctx)
	result, err := service.FindSimilarRecipes(ctx, a.db, caller, a.judge, query, input.Body.CandidateIDs)
	if err != nil {
		return nil, fail(ctx, huma.Error500InternalServerError("Failed to find similar recipes"), err)
	}

	// A Jev failure answers 200 with fewer or no matches: Similar Recipes is additive,
	// and the User was not waiting on it (spec decision 8). It is recorded on
	// the span rather than returned, so it is visible without being an error
	// the client has to handle.
	if result.JudgeErr != nil {
		telemetry.RecordWarning(ctx, "similar recipes: jev", result.JudgeErr)
	}
	telemetry.RecordSimilarRecipes(ctx, string(result.Outcome), result.Candidates, len(result.Matches),
		result.JudgeDuration, jev.Model, result.Usage.InputTokens, result.Usage.OutputTokens)
	// Counts only - never the query or the names (ADR-0008 §1).
	telemetry.Logger().InfoContext(ctx, "similar recipes",
		"similar.outcome", string(result.Outcome),
		"similar.candidates", result.Candidates,
		"similar.matches", len(result.Matches),
		"similar.failed_chunks", result.FailedChunks)

	out := &SimilarRecipesOutput{}
	out.Body.Matches = result.Matches
	return out, nil
}

func (a *App) registerRecipesRoutes(api huma.API) {
	register(api, huma.Operation{
		OperationID: "list-recipes",
		Method:      http.MethodGet,
		Path:        "/recipes",
		Summary:     "List recipes",
		Description: "Returns a lightweight (name/id/tags only) list of every Recipe belonging to the current user's Account.",
		Tags:        []string{"Recipes"},
	}, a.getRecipes)

	register(api, huma.Operation{
		OperationID: "similar-recipes",
		Method:      http.MethodPost,
		Path:        "/recipes/similar",
		Summary:     "Find Similar Recipes",
		Description: "Judges which of the given Recipes someone searching for `query` would want, though their names do not contain it. Answers 200 with no matches when the feature is unconfigured or the model is unavailable: Similar Recipes are additive, never required.",
		Tags:        []string{"Recipes"},
	}, a.getSimilarRecipes)
}
