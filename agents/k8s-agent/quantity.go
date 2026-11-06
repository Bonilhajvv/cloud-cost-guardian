package main

import (
	"strconv"
	"strings"
)

var binarySuffixes = map[string]float64{
	"Ki": 1 << 10,
	"Mi": 1 << 20,
	"Gi": 1 << 30,
	"Ti": 1 << 40,
	"Pi": 1 << 50,
	"Ei": 1 << 60,
}

var decimalSuffixes = map[string]float64{
	"n": 1e-9,
	"u": 1e-6,
	"m": 1e-3,
	"k": 1e3,
	"M": 1e6,
	"G": 1e9,
	"T": 1e12,
	"P": 1e15,
	"E": 1e18,
}

func parseQuantity(raw string) float64 {
	s := strings.TrimSpace(raw)
	if s == "" {
		return 0
	}
	if len(s) > 2 {
		if mult, ok := binarySuffixes[s[len(s)-2:]]; ok {
			return parseNumber(s[:len(s)-2]) * mult
		}
	}
	last := s[len(s)-1:]
	if mult, ok := decimalSuffixes[last]; ok && !strings.ContainsAny(s[:len(s)-1], "eE") {
		return parseNumber(s[:len(s)-1]) * mult
	}
	return parseNumber(s)
}

func parseNumber(s string) float64 {
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return v
}
