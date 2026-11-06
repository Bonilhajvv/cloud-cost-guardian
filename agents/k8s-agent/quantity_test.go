package main

import (
	"math"
	"testing"
)

func TestParseQuantity(t *testing.T) {
	cases := map[string]float64{
		"250m":       0.25,
		"2":          2,
		"0.5":        0.5,
		"123456789n": 0.123456789,
		"1500u":      0.0015,
		"128Mi":      128 * 1024 * 1024,
		"4Gi":        4 * 1024 * 1024 * 1024,
		"3977560Ki":  3977560 * 1024,
		"1G":         1e9,
		"500k":       500000,
		"1e3":        1000,
		"129M":       129e6,
		"":           0,
		"garbage":    0,
	}
	for in, want := range cases {
		if got := parseQuantity(in); math.Abs(got-want) > 1e-9*math.Max(1, want) {
			t.Errorf("parseQuantity(%q) = %v, want %v", in, got, want)
		}
	}
}
