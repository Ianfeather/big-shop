package service

import (
	"context"
	"database/sql"
	"errors"
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
const SimilarThreshold = 0.6

// How candidates are fanned out to Jev - see rankSimilar for why they are
// chunked at all, and why at 10.
const (
	similarChunkSize = 10
	// At most this many chunks in flight at once. The API allows up to 1000
	// candidates, which is 100 chunks; an unbounded fan-out of that size is
	// the kind of burst Jev answers with 429s.
	similarConcurrency = 16
	// The whole fan-out's budget, however many chunks it has. The same figure
	// as jev's per-request timeout, so one slow chunk and a long queue of
	// chunks are bounded alike.
	similarDeadline = 3 * time.Second
)

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
	// Some chunks answered and some did not; the matches are from those
	// that did.
	OutcomePartial SimilarOutcome = "partial"
)

// SimilarResult is FindSimilarRecipes' answer plus what telemetry needs.
type SimilarResult struct {
	Matches []SimilarMatch
	Outcome SimilarOutcome
	// Candidates is how many names were actually sent to Jev, after scoping.
	Candidates int
	Usage      jev.Usage
	// JudgeDuration is how long the Jev fan-out took; zero when none was made.
	JudgeDuration time.Duration
	// FailedChunks is how many chunks gave no answer.
	FailedChunks int
	// JudgeErr is why they gave none, joined. Not returned as an error: a Jev
	// failure is a missing or shorter tranche, not a failed request (decision
	// 8), so the caller records it and answers 200.
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
//
// Candidates go to Jev in chunks of similarChunkSize, several at once, not in
// one request. One request carrying every name was the specced design, and
// Phase 0 found it unusable on real data: a judgment's quality decays with the
// name's position in the list, so in a 150-Recipe Account the breakfast dishes
// at positions ~90-100 scored below pork chops for "breakfast". One request
// per name was accurate but took 5-7s for 150 names. Chunks of 10 matched
// per-name judgments closely and answered in ~0.4s.
//
// A chunk that fails or misses similarDeadline is dropped and the rest are
// kept: Similar Recipes are additive, so a tranche missing a few Recipes is
// better than none, and nobody waits past the deadline for the stragglers.
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

	ctx, cancel := context.WithTimeout(ctx, similarDeadline)
	defer cancel()

	type chunkResult struct {
		start         int
		probabilities []float64
		usage         jev.Usage
		err           error
	}

	var chunks [][]candidate
	for start := 0; start < len(candidates); start += similarChunkSize {
		end := min(start+similarChunkSize, len(candidates))
		chunks = append(chunks, candidates[start:end])
	}

	results := make(chan chunkResult, len(chunks))
	slots := make(chan struct{}, similarConcurrency)
	started := time.Now()
	for i, chunk := range chunks {
		go func(start int, chunk []candidate) {
			select {
			case slots <- struct{}{}:
				defer func() { <-slots }()
			case <-ctx.Done():
				// Never got a slot before the deadline: dropped, like a
				// chunk that timed out mid-call.
				results <- chunkResult{start: start, err: ctx.Err()}
				return
			}
			names := make([]string, len(chunk))
			for j, c := range chunk {
				names[j] = c.name
			}
			probabilities, _, usage, err := judge.Relevance(ctx, query, names)
			results <- chunkResult{start: start, probabilities: probabilities, usage: usage, err: err}
		}(i*similarChunkSize, chunk)
	}

	var errs []error
	for range chunks {
		r := <-results
		result.Usage.InputTokens += r.usage.InputTokens
		result.Usage.OutputTokens += r.usage.OutputTokens
		if r.err != nil {
			errs = append(errs, r.err)
			continue
		}
		for j, p := range r.probabilities {
			if p >= SimilarThreshold {
				result.Matches = append(result.Matches, SimilarMatch{ID: candidates[r.start+j].id, Probability: p})
			}
		}
	}
	result.JudgeDuration = time.Since(started)
	result.FailedChunks = len(errs)
	result.JudgeErr = errors.Join(errs...)

	// Ordered by probability, ties by id, so the same answers always render
	// the same list whichever chunk happened to come back first.
	sort.Slice(result.Matches, func(i, j int) bool {
		if result.Matches[i].Probability != result.Matches[j].Probability {
			return result.Matches[i].Probability > result.Matches[j].Probability
		}
		return result.Matches[i].ID < result.Matches[j].ID
	})

	switch {
	case len(errs) == len(chunks):
		result.Outcome = OutcomeError
	case len(errs) > 0:
		result.Outcome = OutcomePartial
	case len(result.Matches) == 0:
		result.Outcome = OutcomeEmpty
	default:
		result.Outcome = OutcomeResults
	}
	return result
}
