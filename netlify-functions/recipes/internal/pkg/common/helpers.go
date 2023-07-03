package common

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
)

// Min returns the smaller of x or y.
func Min(x, y int) int {
	if x > y {
		return y
	}
	return x
}

// Slugify converts a string into a slug
func Slugify(s string) string {
	slug := strings.ReplaceAll(s, " ", "-")
	slugLength := Min(60, len(slug))
	return strings.ToLower(slug[0:slugLength])
}

// RandToken creates a random hex string for short-lived tokens
func RandToken(n int) (string, error) {
	bytes := make([]byte, n)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}
