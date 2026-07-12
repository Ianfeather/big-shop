package service

import "testing"

func TestParseClassificationContent(t *testing.T) {
	tests := []struct {
		name        string
		content     string
		wantUnit    string
		wantWeight  float64
		expectError bool
	}{
		{
			name:       "count-based ingredient",
			content:    `{"preferredUnit": "whole", "averageWeightGrams": 150}`,
			wantUnit:   "whole",
			wantWeight: 150,
		},
		{
			name:       "weight-based ingredient with no average weight",
			content:    `{"preferredUnit": "gram", "averageWeightGrams": null}`,
			wantUnit:   "gram",
			wantWeight: 0,
		},
		{
			name:       "no unit fits",
			content:    `{"preferredUnit": "", "averageWeightGrams": null}`,
			wantUnit:   "",
			wantWeight: 0,
		},
		{
			name:        "malformed json",
			content:     `not json`,
			expectError: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseClassificationContent(tc.content)
			if tc.expectError {
				if err == nil {
					t.Fatalf("expected an error, got %v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.PreferredUnit != tc.wantUnit {
				t.Errorf("PreferredUnit = %q, want %q", got.PreferredUnit, tc.wantUnit)
			}
			if got.AverageWeightGrams != tc.wantWeight {
				t.Errorf("AverageWeightGrams = %v, want %v", got.AverageWeightGrams, tc.wantWeight)
			}
		})
	}
}

func TestIsKnownUnit(t *testing.T) {
	units := []Unit{{Name: "gram"}, {Name: "whole"}}

	if !isKnownUnit("gram", units) {
		t.Errorf("expected gram to be a known unit")
	}
	if isKnownUnit("cup", units) {
		t.Errorf("expected cup not to be a known unit")
	}
}
