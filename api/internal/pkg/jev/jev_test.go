package jev

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return &Client{key: "test-key", client: server.Client(), endpoint: server.URL}
}

func TestUnconfiguredClient(t *testing.T) {
	t.Setenv("TYPESAFE_API_KEY", "")
	c := New()
	if c.Configured() {
		t.Fatal("Configured() = true with TYPESAFE_API_KEY unset")
	}
	if _, _, _, err := c.Relevance(context.Background(), "curry", []string{"Prawn Balti"}); err == nil {
		t.Fatal("Relevance on an unconfigured client should be an error, not a quiet empty answer")
	}
}

// One request carries every name, in order, with one question per name that
// points at that name's index - the shape decision 2 of the spec settled on.
func TestRelevanceSendsOneRequestWithAQuestionPerName(t *testing.T) {
	var requests int
	var got request
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		requests++
		if auth := r.Header.Get("Authorization"); auth != "Bearer test-key" {
			t.Errorf("Authorization = %q", auth)
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("decoding request: %v", err)
		}
		w.Write([]byte(`{"model":"jev-1.13.0","answers":{"r0":{"type":"noul","noul":0.9},"r1":{"type":"noul","noul":0.1}},"usage":{"input_tokens":300,"output_tokens":20}}`))
	})

	probabilities, model, usage, err := c.Relevance(context.Background(), "curry", []string{"Prawn Balti", "Lasagne"})
	if err != nil {
		t.Fatalf("Relevance: %v", err)
	}

	if requests != 1 {
		t.Errorf("made %d requests, want 1", requests)
	}
	if got.Model != Model || got.State.Query != "curry" || strings.Join(got.State.Recipes, "|") != "Prawn Balti|Lasagne" {
		t.Errorf("request = %+v", got)
	}
	if len(got.Questions) != 2 {
		t.Fatalf("got %d questions, want 2", len(got.Questions))
	}
	for id, index := range map[string]string{"r0": "`recipes[0]`", "r1": "`recipes[1]`"} {
		q := got.Questions[id]
		if q.Type != "noul" || !strings.Contains(q.Instructions, index) || !strings.Contains(q.Instructions, "`query`") {
			t.Errorf("question %s = %+v, want a noul naming %s and `query`", id, q, index)
		}
		if q.Criteria["true"] == "" || q.Criteria["false"] == "" {
			t.Errorf("question %s has no criteria", id)
		}
	}

	if len(probabilities) != 2 || probabilities[0] != 0.9 || probabilities[1] != 0.1 {
		t.Errorf("probabilities = %v, want [0.9 0.1]", probabilities)
	}
	if model != "jev-1.13.0" || usage.InputTokens != 300 || usage.OutputTokens != 20 {
		t.Errorf("model, usage = %q, %+v", model, usage)
	}
}

// A 2xx missing an answer is Jev breaking its contract. Reading it as a "no"
// would hide that behind an innocently short tranche.
func TestRelevanceRejectsAMissingAnswer(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"model":"jev","answers":{"r0":{"type":"noul","noul":0.9}}}`))
	})
	if _, _, _, err := c.Relevance(context.Background(), "curry", []string{"a", "b"}); err == nil {
		t.Fatal("want an error for a response with no answer for r1")
	}
}

func TestRelevanceReportsJevStatus(t *testing.T) {
	for _, status := range []int{http.StatusUnauthorized, http.StatusTooManyRequests, 529, http.StatusInternalServerError} {
		c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(status)
			w.Write([]byte(`{"error":"nope"}`))
		})
		_, _, _, err := c.Relevance(context.Background(), "curry", []string{"a"})
		var se *StatusError
		if !errors.As(err, &se) || se.Status != status {
			t.Errorf("status %d: err = %v, want a StatusError carrying it", status, err)
		}
	}
}

// The answer is useless once the User has moved on, so a slow Jev is cut off
// rather than waited for.
func TestRelevanceIsBoundedByTheClientTimeout(t *testing.T) {
	release := make(chan struct{})
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		<-release
	})
	defer close(release)
	c.client.Timeout = 50 * time.Millisecond

	started := time.Now()
	if _, _, _, err := c.Relevance(context.Background(), "curry", []string{"a"}); err == nil {
		t.Fatal("want a timeout error")
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Errorf("took %v; the timeout did not bound the call", elapsed)
	}
}

func TestNewUsesTheProductionBounds(t *testing.T) {
	t.Setenv("TYPESAFE_API_KEY", "k")
	c := New()
	if !c.Configured() || c.client.Timeout != requestTimeout || c.endpoint != endpoint {
		t.Errorf("New() = %+v", c)
	}
}
