package common

import (
	"fmt"
	"strconv"
	"strings"
)

// ParseQuantity parses a part/list quantity string ("mixed number" per the
// column comment on part.quantity and list.quantity) into a float64. It
// supports plain decimals ("1.5"), simple fractions ("1/2"), and mixed
// numbers ("1 1/2"). Previously this was parsed with strconv.ParseFloat
// directly, which fails (and silently drops the ingredient) on anything
// containing a fraction.
func ParseQuantity(raw string) (float64, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return 0, fmt.Errorf("cannot parse empty quantity")
	}

	parts := strings.Fields(s)
	switch len(parts) {
	case 1:
		return parseQuantityPart(parts[0])
	case 2:
		whole, err := strconv.ParseFloat(parts[0], 64)
		if err != nil {
			return 0, fmt.Errorf("cannot parse quantity %q: %w", raw, err)
		}
		frac, err := parseFraction(parts[1])
		if err != nil {
			return 0, fmt.Errorf("cannot parse quantity %q: %w", raw, err)
		}
		if whole < 0 {
			return whole - frac, nil
		}
		return whole + frac, nil
	default:
		return 0, fmt.Errorf("cannot parse quantity %q", raw)
	}
}

func parseQuantityPart(s string) (float64, error) {
	if strings.Contains(s, "/") {
		return parseFraction(s)
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, fmt.Errorf("cannot parse quantity %q: %w", s, err)
	}
	return v, nil
}

func parseFraction(s string) (float64, error) {
	fparts := strings.SplitN(s, "/", 2)
	if len(fparts) != 2 {
		return 0, fmt.Errorf("cannot parse fraction %q", s)
	}
	num, err := strconv.ParseFloat(fparts[0], 64)
	if err != nil {
		return 0, fmt.Errorf("cannot parse fraction %q: %w", s, err)
	}
	denom, err := strconv.ParseFloat(fparts[1], 64)
	if err != nil || denom == 0 {
		return 0, fmt.Errorf("cannot parse fraction %q", s)
	}
	return num / denom, nil
}
