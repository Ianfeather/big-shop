package service

import "testing"

func TestUnitCatalogGet(t *testing.T) {
	catalog := UnitCatalog{
		"gram":       {Kind: KindWeight, Factor: 1},
		"tablespoon": {Kind: KindVolume, Factor: 15},
		"tin":        {Kind: KindRelative},
		"":           {Kind: KindRelative},
	}

	tests := []struct {
		name       string
		unit       string
		wantKind   UnitKind
		wantFactor float64
	}{
		{"known absolute weight", "gram", KindWeight, 1},
		{"known absolute volume", "tablespoon", KindVolume, 15},
		{"known relative", "tin", KindRelative, 0},
		// The blank-name row is the count sentinel ("2 eggs"), a real row
		// rather than a missing one - it must resolve as Relative, not fall
		// through to the unknown-unit path.
		{"blank count sentinel", "", KindRelative, 0},
		// Recipe Import can introduce a Unit nobody has seen before at any
		// time. That's a normal state, not an error: treat it as Relative so
		// it simply doesn't combine until it has a Unit Size.
		{"unknown unit falls back to relative", "sprig", KindRelative, 0},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := catalog.Get(tc.unit)
			if got.Kind != tc.wantKind {
				t.Errorf("Kind: expected %q but got %q", tc.wantKind, got.Kind)
			}
			if got.Factor != tc.wantFactor {
				t.Errorf("Factor: expected %v but got %v", tc.wantFactor, got.Factor)
			}
		})
	}
}

func TestUnitInfoIsAbsolute(t *testing.T) {
	tests := []struct {
		name string
		info UnitInfo
		want bool
	}{
		{"weight is absolute", UnitInfo{Kind: KindWeight, Factor: 1}, true},
		{"volume is absolute", UnitInfo{Kind: KindVolume, Factor: 15}, true},
		{"relative is not", UnitInfo{Kind: KindRelative}, false},
		{"zero value is not", UnitInfo{}, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.info.IsAbsolute(); got != tc.want {
				t.Errorf("expected %v but got %v", tc.want, got)
			}
		})
	}
}

// Two Relative Units share KindRelative, so comparing Kind alone would call a
// tin and a pinch compatible. This guards the reason IsAbsolute exists - the
// aggregator in the next session decides "can these two Amounts be summed?"
// and must not answer yes here.
func TestRelativeUnitsAreNotCombinableDespiteEqualKinds(t *testing.T) {
	tin := UnitInfo{Kind: KindRelative}
	pinch := UnitInfo{Kind: KindRelative}

	if tin.Kind != pinch.Kind {
		t.Fatal("precondition: both Relative Units should share a Kind")
	}
	if tin.IsAbsolute() || pinch.IsAbsolute() {
		t.Error("a Relative Unit must never report as absolute")
	}
}
