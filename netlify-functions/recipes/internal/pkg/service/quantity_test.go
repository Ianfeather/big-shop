package service

import "testing"

func TestParseQuantity(t *testing.T) {
	tests := []struct {
		name  string
		raw   string
		want  float64
		wants bool
	}{
		{"whole number", "2", 2, true},
		{"decimal", "1.5", 1.5, true},
		{"leading decimal point", "0.25", 0.25, true},
		{"surrounding whitespace", "  200  ", 200, true},
		{"vulgar fraction", "1/2", 0.5, true},
		{"mixed number", "1 1/2", 1.5, true},
		{"mixed number with wide spacing", "2  3/4", 2.75, true},

		{"empty", "", 0, false},
		{"whitespace only", "   ", 0, false},
		{"words", "a handful", 0, false},
		{"words that look numeric", "to taste", 0, false},
		{"trailing unit text", "200g", 0, false},
		{"divide by zero", "1/0", 0, false},
		{"malformed fraction", "1/", 0, false},
		{"unicode fraction is not supported", "½", 0, false},

		// Zero parses fine and contributes nothing. Rejecting it would print a
		// verbatim "0 gram" beside the real total instead of adding nothing.
		{"zero", "0", 0, true},
		// A negative would silently subtract from whatever it was summed with,
		// so it's surfaced verbatim instead.
		{"negative", "-5", 0, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := ParseQuantity(tc.raw)
			if ok != tc.wants {
				t.Fatalf("ok: expected %v but got %v", tc.wants, ok)
			}
			if ok && got != tc.want {
				t.Errorf("expected %v but got %v", tc.want, got)
			}
		})
	}
}

func TestFormatQuantity(t *testing.T) {
	tests := []struct {
		name string
		in   float64
		want string
	}{
		{"whole number loses its decimal", 3, "3"},
		{"one decimal place", 1.1, "1.1"},
		{"half", 0.5, "0.5"},
		{"large whole", 1700, "1700"},
		// Summing converted values introduces float noise; it must not reach
		// the shopping list as "0.30000000000000004 gram".
		{"float noise is rounded away", 0.1 + 0.2, "0.3"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := formatQuantity(tc.in); got != tc.want {
				t.Errorf("expected %q but got %q", tc.want, got)
			}
		})
	}
}
