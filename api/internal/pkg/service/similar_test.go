package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
	"testing"
	"time"

	"recipes/internal/pkg/jev"
)

// fakeJudge answers by name, so it gives the same answer however the
// candidates are chunked, and records every chunk it was asked about.
type fakeJudge struct {
	configured bool
	// probabilities by name; a name not listed scores 0.
	probabilities map[string]float64
	// failWhen, if set, fails any chunk containing that name.
	failWhen string
	// blockWhen, if set, makes any chunk containing that name wait for its
	// context to end, as a chunk that never answers would.
	blockWhen string

	mu     sync.Mutex
	chunks [][]string
}

func (f *fakeJudge) Configured() bool { return f.configured }

func (f *fakeJudge) Relevance(ctx context.Context, _ string, names []string) ([]float64, string, jev.Usage, error) {
	f.mu.Lock()
	f.chunks = append(f.chunks, names)
	f.mu.Unlock()

	for _, n := range names {
		if n == f.failWhen {
			return nil, "", jev.Usage{}, &jev.StatusError{Status: 529}
		}
		if n == f.blockWhen {
			<-ctx.Done()
			return nil, "", jev.Usage{}, ctx.Err()
		}
	}
	out := make([]float64, len(names))
	for i, n := range names {
		out[i] = f.probabilities[n]
	}
	return out, "jev-test", jev.Usage{InputTokens: 10, OutputTokens: 2}, nil
}

func (f *fakeJudge) chunkSizes() []int {
	f.mu.Lock()
	defer f.mu.Unlock()
	sizes := make([]int, len(f.chunks))
	for i, c := range f.chunks {
		sizes[i] = len(c)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(sizes)))
	return sizes
}

var candidates = []candidate{{id: 1, name: "Lasagne"}, {id: 2, name: "Prawn Balti"}, {id: 3, name: "Lamb Rogan Josh"}, {id: 4, name: "Chicken Madras"}}

// many returns n candidates named "r<id>", ids 1..n.
func many(n int) []candidate {
	out := make([]candidate, n)
	for i := range out {
		out[i] = candidate{id: i + 1, name: fmt.Sprintf("r%d", i+1)}
	}
	return out
}

func TestRankSimilarKeepsThoseAtOrOverTheThresholdMostProbableFirst(t *testing.T) {
	judge := &fakeJudge{configured: true, probabilities: map[string]float64{
		"Lasagne": 0.02, "Prawn Balti": 0.81, "Lamb Rogan Josh": SimilarThreshold, "Chicken Madras": 0.97,
	}}

	result := rankSimilar(context.Background(), judge, "curry", candidates)

	want := []SimilarMatch{{ID: 4, Probability: 0.97}, {ID: 2, Probability: 0.81}, {ID: 3, Probability: SimilarThreshold}}
	if len(result.Matches) != len(want) {
		t.Fatalf("matches = %+v, want %+v", result.Matches, want)
	}
	for i := range want {
		if result.Matches[i] != want[i] {
			t.Errorf("matches[%d] = %+v, want %+v", i, result.Matches[i], want[i])
		}
	}
	if result.Outcome != OutcomeResults || result.Candidates != 4 || result.Usage.InputTokens != 10 {
		t.Errorf("result = %+v", result)
	}
}

// Phase 0: one request carrying every name judged the later names badly. So
// they go in chunks of similarChunkSize, and every candidate is in exactly one.
func TestRankSimilarSendsCandidatesInChunks(t *testing.T) {
	judge := &fakeJudge{configured: true, probabilities: map[string]float64{"r3": 0.9, "r17": 0.8, "r25": 0.7}}

	result := rankSimilar(context.Background(), judge, "curry", many(25))

	if got := judge.chunkSizes(); fmt.Sprint(got) != "[10 10 5]" {
		t.Errorf("chunk sizes = %v, want [10 10 5]", got)
	}
	seen := map[string]int{}
	for _, c := range judge.chunks {
		for _, n := range c {
			seen[n]++
		}
	}
	if len(seen) != 25 {
		t.Errorf("%d distinct names sent, want 25", len(seen))
	}
	for n, count := range seen {
		if count != 1 {
			t.Errorf("%s sent %d times", n, count)
		}
	}

	// Mapped back to the right ids across chunk boundaries, and usage summed.
	want := []SimilarMatch{{ID: 3, Probability: 0.9}, {ID: 17, Probability: 0.8}, {ID: 25, Probability: 0.7}}
	if fmt.Sprint(result.Matches) != fmt.Sprint(want) {
		t.Errorf("matches = %+v, want %+v", result.Matches, want)
	}
	if result.Usage.InputTokens != 30 {
		t.Errorf("input tokens = %d, want 30 (three chunks)", result.Usage.InputTokens)
	}
}

func TestRankSimilarEqualProbabilitiesKeepIDOrder(t *testing.T) {
	probabilities := map[string]float64{}
	for _, c := range many(25) {
		probabilities[c.name] = 0.9
	}
	judge := &fakeJudge{configured: true, probabilities: probabilities}

	result := rankSimilar(context.Background(), judge, "food", many(25))

	for i, m := range result.Matches {
		if m.ID != i+1 {
			t.Fatalf("matches = %+v, want id order for ties whichever chunk answered first", result.Matches)
		}
	}
}

func TestRankSimilarNothingOverTheThresholdIsEmptyNotAnError(t *testing.T) {
	judge := &fakeJudge{configured: true, probabilities: map[string]float64{"Prawn Balti": SimilarThreshold - 0.01}}
	result := rankSimilar(context.Background(), judge, "curr", candidates)
	if result.Outcome != OutcomeEmpty || len(result.Matches) != 0 || result.Matches == nil {
		t.Errorf("result = %+v, want empty (and a non-nil slice, so the JSON is [] not null)", result)
	}
}

func TestRankSimilarUnconfiguredCallsNothing(t *testing.T) {
	judge := &fakeJudge{configured: false}
	result := rankSimilar(context.Background(), judge, "curry", candidates)
	if len(judge.chunks) != 0 {
		t.Errorf("judge called %d times while unconfigured", len(judge.chunks))
	}
	if result.Outcome != OutcomeDisabled || len(result.Matches) != 0 || result.Matches == nil {
		t.Errorf("result = %+v", result)
	}
}

// After scoping, every id may turn out to be someone else's or deleted. There
// is then nothing to ask, and no reason to pay for asking.
func TestRankSimilarNoCandidatesCallsNothing(t *testing.T) {
	judge := &fakeJudge{configured: true}
	result := rankSimilar(context.Background(), judge, "curry", nil)
	if len(judge.chunks) != 0 {
		t.Errorf("judge called %d times with no candidates", len(judge.chunks))
	}
	if result.Outcome != OutcomeEmpty {
		t.Errorf("outcome = %q, want empty", result.Outcome)
	}
}

// One failing chunk costs only its own Recipes: the rest still show.
func TestRankSimilarAFailedChunkIsDroppedAndTheRestKept(t *testing.T) {
	judge := &fakeJudge{configured: true, failWhen: "r5", probabilities: map[string]float64{"r3": 0.9, "r15": 0.8}}

	result := rankSimilar(context.Background(), judge, "curry", many(20))

	if fmt.Sprint(result.Matches) != fmt.Sprint([]SimilarMatch{{ID: 15, Probability: 0.8}}) {
		t.Errorf("matches = %+v, want only the answering chunk's", result.Matches)
	}
	var se *jev.StatusError
	if result.Outcome != OutcomePartial || result.FailedChunks != 1 || !errors.As(result.JudgeErr, &se) {
		t.Errorf("result = %+v, want partial with the cause kept", result)
	}
}

// A Jev failure is an empty tranche for the User and an error for telemetry -
// never a failed request (spec decision 8).
func TestRankSimilarEveryChunkFailingIsEmptyWithTheCauseKept(t *testing.T) {
	judge := &fakeJudge{configured: true, failWhen: "Lasagne"}
	result := rankSimilar(context.Background(), judge, "curry", candidates)
	var se *jev.StatusError
	if result.Outcome != OutcomeError || len(result.Matches) != 0 || !errors.As(result.JudgeErr, &se) {
		t.Errorf("result = %+v", result)
	}
}

// A chunk that never answers is cut off at the deadline, not waited for, and
// the chunks that did answer are kept.
func TestRankSimilarAHungChunkIsCutOffAtTheDeadline(t *testing.T) {
	judge := &fakeJudge{configured: true, blockWhen: "r15", probabilities: map[string]float64{"r3": 0.9}}

	started := time.Now()
	result := rankSimilar(context.Background(), judge, "curry", many(20))
	elapsed := time.Since(started)

	if elapsed > similarDeadline+time.Second {
		t.Errorf("took %v, want it bounded by similarDeadline (%v)", elapsed, similarDeadline)
	}
	if fmt.Sprint(result.Matches) != fmt.Sprint([]SimilarMatch{{ID: 3, Probability: 0.9}}) || result.Outcome != OutcomePartial {
		t.Errorf("result = %+v, want the answering chunk's matches, partial", result)
	}
}
