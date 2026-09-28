package service

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"

	"recipes/internal/pkg/common"
	"recipes/internal/pkg/jev"
	"recipes/internal/pkg/telemetry"
)

// SimilarThreshold is the probability a Recipe needs to be shown as a Similar
// Recipe. Set in the spec's Phase 0 against real Recipe names
// (specs/recipe-search-similar-recipes.md); raise it rather than capping the
// tranche if the tail gets noisy (decision 9).
const SimilarThreshold = 0.5

// SimilarMatch is one Similar Recipe: which Recipe, and how sure Jev was.
type SimilarMatch struct {
	ID          int     `json:"id"`
	Probability float64 `json:"probability"`
}

// RelevanceJudge is the slice of jev.Client this package uses, so a test can
// stand in for Jev without a network.
type RelevanceJudge interface {
	Configured() bool
	Relevance(ctx context.Context, query string, names []string) ([]float64, string, jev.Usage, error)
}

// SimilarOutcome says how a FindSimilarRecipes call ended, for telemetry. The
// caller sees the same thing - an empty list - for all but OutcomeResults, and
// these are what tell them apart afterwards.
type SimilarOutcome string

const (
	OutcomeResults  SimilarOutcome = "results"
	OutcomeEmpty    SimilarOutcome = "empty"
	OutcomeDisabled SimilarOutcome = "disabled"
	OutcomeError    SimilarOutcome = "error"
)

// SimilarResult is FindSimilarRecipes' answer plus what telemetry needs.
type SimilarResult struct {
	Matches []SimilarMatch
	Outcome SimilarOutcome
	// Candidates is how many names were actually sent to Jev, after scoping.
	Candidates int
	Model      string
	Usage      jev.Usage
	// JudgeDuration is how long the Jev call took; zero when none was made.
	JudgeDuration time.Duration
	// JudgeErr is why Jev gave no answer, when it didn't. Not returned as an
	// error: a Jev failure is an empty tranche, not a failed request
	// (decision 8), so the caller records it and answers 200.
	JudgeErr error
}

type candidate struct {
	id   int
	name string
}

// FindSimilarRecipes returns the Recipes among ids, belonging to caller's
// Account, that Jev judges someone searching for query would want - most
// probable first, only those at or above SimilarThreshold.
//
// ids come from the client, so they are scoped here: an id that is not this
// Account's is dropped silently, since it is either stale (another member
// deleted the Recipe) or not this caller's to ask about. The names Jev sees
// therefore only ever come from this Account's own Recipes - the route is not
// a relay for arbitrary text on our key (decision 11).
//
// The returned error is for the database only; see SimilarResult.JudgeErr.
func FindSimilarRecipes(ctx context.Context, db *sql.DB, caller *common.Caller, judge RelevanceJudge, query string, ids []int) (SimilarResult, error) {
	accountID, err := caller.AccountID()
	if err != nil {
		return SimilarResult{}, fmt.Errorf("getting account ID: %w", err)
	}
	telemetry.SetAccountID(ctx, accountID)

	// Scoped before the judge is consulted, even when it is unconfigured and
	// the answer is already known to be empty. That costs one indexed query
	// and buys the only coverage this SQL gets in CI: the e2e stack has no
	// key, so this is the path it exercises.
	candidates, err := loadCandidates(ctx, db, accountID, ids)
	if err != nil {
		return SimilarResult{}, err
	}

	return rankSimilar(ctx, judge, query, candidates), nil
}

func loadCandidates(ctx context.Context, db *sql.DB, accountID int, ids []int) ([]candidate, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := make([]interface{}, 0, len(ids)+1)
	args = append(args, accountID)
	for _, id := range ids {
		args = append(args, id)
	}

	// Ordered so the same candidate set always produces the same request -
	// which makes a judgment reproducible when someone asks why a Recipe did
	// or did not appear.
	rows, err := db.QueryContext(ctx,
		`SELECT id, name FROM recipe WHERE account_id = ? AND id IN (`+placeholders+`) ORDER BY id`,
		args...)
	if err != nil {
		return nil, fmt.Errorf("querying candidate recipes: %w", err)
	}
	defer rows.Close()

	var candidates []candidate
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.id, &c.name); err != nil {
			return nil, err
		}
		candidates = append(candidates, c)
	}
	return candidates, rows.Err()
}

// rankSimilar is FindSimilarRecipes without the database: judge the
// candidates, keep those over the threshold, most probable first.
func rankSimilar(ctx context.Context, judge RelevanceJudge, query string, candidates []candidate) SimilarResult {
	result := SimilarResult{Matches: []SimilarMatch{}, Candidates: len(candidates)}

	if judge == nil || !judge.Configured() {
		result.Outcome = OutcomeDisabled
		result.Candidates = 0
		return result
	}
	if len(candidates) == 0 {
		result.Outcome = OutcomeEmpty
		return result
	}

	names := make([]string, len(candidates))
	for i, c := range candidates {
		names[i] = c.name
	}

	started := time.Now()
	probabilities, model, usage, err := judge.Relevance(ctx, query, names)
	result.JudgeDuration = time.Since(started)
	result.Model, result.Usage = model, usage
	if err != nil {
		result.Outcome = OutcomeError
		result.JudgeErr = err
		return result
	}

	for i, p := range probabilities {
		if p >= SimilarThreshold {
			result.Matches = append(result.Matches, SimilarMatch{ID: candidates[i].id, Probability: p})
		}
	}
	// Stable, so equal probabilities keep id order and the same input always
	// renders the same list.
	sort.SliceStable(result.Matches, func(i, j int) bool {
		return result.Matches[i].Probability > result.Matches[j].Probability
	})

	if len(result.Matches) == 0 {
		result.Outcome = OutcomeEmpty
	} else {
		result.Outcome = OutcomeResults
	}
	return result
}
