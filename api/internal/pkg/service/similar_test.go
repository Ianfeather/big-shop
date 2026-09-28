package service

import (
	"context"
	"errors"
	"testing"

	"recipes/internal/pkg/jev"
)

type fakeJudge struct {
	configured    bool
	probabilities []float64
	err           error
	calls         int
	names         []string
}

func (f *fakeJudge) Configured() bool { return f.configured }

func (f *fakeJudge) Relevance(_ context.Context, _ string, names []string) ([]float64, string, jev.Usage, error) {
	f.calls++
	f.names = names
	return f.probabilities, "jev-test", jev.Usage{InputTokens: 10, OutputTokens: 2}, f.err
}

var candidates = []candidate{{id: 1, name: "Lasagne"}, {id: 2, name: "Prawn Balti"}, {id: 3, name: "Lamb Rogan Josh"}, {id: 4, name: "Chicken Madras"}}

func TestRankSimilarKeepsThoseOverTheThresholdMostProbableFirst(t *testing.T) {
	judge := &fakeJudge{configured: true, probabilities: []float64{0.02, 0.81, SimilarThreshold, 0.97}}

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
	// Names go to Jev in the candidates' order, which is what maps each
	// probability back to its Recipe.
	if len(judge.names) != 4 || judge.names[1] != "Prawn Balti" {
		t.Errorf("names sent = %v", judge.names)
	}
}

func TestRankSimilarEqualProbabilitiesKeepIDOrder(t *testing.T) {
	judge := &fakeJudge{configured: true, probabilities: []float64{0.9, 0.9, 0.9, 0.9}}
	result := rankSimilar(context.Background(), judge, "food", candidates)
	for i, m := range result.Matches {
		if m.ID != candidates[i].id {
			t.Fatalf("matches = %+v, want id order for ties", result.Matches)
		}
	}
}

func TestRankSimilarNothingOverTheThresholdIsEmptyNotAnError(t *testing.T) {
	judge := &fakeJudge{configured: true, probabilities: []float64{0.1, 0.2, 0.3, 0.49}}
	result := rankSimilar(context.Background(), judge, "curr", candidates)
	if result.Outcome != OutcomeEmpty || len(result.Matches) != 0 || result.Matches == nil {
		t.Errorf("result = %+v, want empty (and a non-nil slice, so the JSON is [] not null)", result)
	}
}

func TestRankSimilarUnconfiguredCallsNothing(t *testing.T) {
	judge := &fakeJudge{configured: false}
	result := rankSimilar(context.Background(), judge, "curry", candidates)
	if judge.calls != 0 {
		t.Errorf("judge called %d times while unconfigured", judge.calls)
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
	if judge.calls != 0 {
		t.Errorf("judge called %d times with no candidates", judge.calls)
	}
	if result.Outcome != OutcomeEmpty {
		t.Errorf("outcome = %q, want empty", result.Outcome)
	}
}

// A Jev failure is an empty tranche for the User and an error for telemetry -
// never a failed request (spec decision 8).
func TestRankSimilarJudgeFailureIsEmptyWithTheCauseKept(t *testing.T) {
	cause := &jev.StatusError{Status: 529}
	judge := &fakeJudge{configured: true, err: cause}
	result := rankSimilar(context.Background(), judge, "curry", candidates)
	if result.Outcome != OutcomeError || len(result.Matches) != 0 || !errors.Is(result.JudgeErr, cause) {
		t.Errorf("result = %+v", result)
	}
}
