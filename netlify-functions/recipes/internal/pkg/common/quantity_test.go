package common

import "testing"

func TestParseQuantity(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    float64
		wantErr bool
	}{
		{name: "integer", raw: "3", want: 3},
		{name: "decimal", raw: "1.5", want: 1.5},
		{name: "simple fraction", raw: "1/2", want: 0.5},
		{name: "mixed number", raw: "1 1/2", want: 1.5},
		{name: "mixed number with larger fraction", raw: "2 3/4", want: 2.75},
		{name: "surrounding whitespace", raw: "  3  ", want: 3},
		{name: "empty", raw: "", wantErr: true},
		{name: "garbage", raw: "a lot", wantErr: true},
		{name: "zero denominator", raw: "1/0", wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseQuantity(tc.raw)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error for %q, got %v", tc.raw, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error for %q: %v", tc.raw, err)
			}
			if got != tc.want {
				t.Errorf("ParseQuantity(%q) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}
