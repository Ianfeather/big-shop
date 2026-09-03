package service

import (
	"math"
	"strconv"
	"strings"
)

// ParseQuantity reads a quantity as it's stored on an Ingredient Line - a
// varchar the column comment calls a "mixed number". It accepts a decimal
// ("2", "1.5"), a vulgar fraction ("1/2") or a mixed number ("1 1/2").
//
// It reports ok=false rather than an error for anything it can't read, because
// an unreadable quantity isn't a failure to propagate: the caller keeps the
// Amount verbatim so it still reaches the shopper. That's the fix for the old
// behaviour, where a failed strconv.ParseFloat was swallowed by an `if err ==
// nil` with no else and the line silently vanished from the Shopping List.
//
// Zero is accepted and simply contributes nothing. Rejecting it would be worse
// than useless: "0" parses perfectly well, so treating it as unreadable would
// print a verbatim "0 gram" next to the real total rather than quietly adding
// nothing to it.
//
// Negatives are rejected. A negative quantity is meaningless on a shopping
// list, and accepting one would silently subtract from whatever it was summed
// with; surfacing it verbatim at least makes the bad data visible.
func ParseQuantity(raw string) (float64, bool) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return 0, false
	}

	// Plain decimal - much the most common case in real data.
	if v, err := strconv.ParseFloat(s, 64); err == nil {
		return v, isUsableQuantity(v)
	}

	// Mixed number ("1 1/2") or a bare fraction ("1/2").
	whole := 0.0
	fraction := s
	if i := strings.IndexAny(s, " \t"); i != -1 {
		w, err := strconv.ParseFloat(strings.TrimSpace(s[:i]), 64)
		if err != nil {
			return 0, false
		}
		whole = w
		fraction = strings.TrimSpace(s[i+1:])
	}

	slash := strings.Index(fraction, "/")
	if slash == -1 {
		return 0, false
	}
	numerator, err := strconv.ParseFloat(strings.TrimSpace(fraction[:slash]), 64)
	if err != nil {
		return 0, false
	}
	denominator, err := strconv.ParseFloat(strings.TrimSpace(fraction[slash+1:]), 64)
	if err != nil || denominator == 0 {
		return 0, false
	}

	v := whole + numerator/denominator
	return v, isUsableQuantity(v)
}

func isUsableQuantity(v float64) bool {
	return v >= 0 && !math.IsInf(v, 0) && !math.IsNaN(v)
}

// formatQuantity renders an accumulated quantity for display, dropping the
// float noise that summing converted values introduces (0.1+0.2 arriving as
// 0.30000000000000004) and any trailing zeros, so "3" doesn't print as "3.00".
func formatQuantity(v float64) string {
	rounded := math.Round(v*1e6) / 1e6
	return strconv.FormatFloat(rounded, 'f', -1, 64)
}
