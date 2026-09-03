package service

import (
	"context"
	"database/sql"
)

// Unit is used to constrain ingredients
type Unit struct {
	Name string `json:"name"`
	ID   int    `json:"id"`
}

// UnitKind mirrors the `unit`.`kind` enum. Named "kind" rather than "dimension"
// because weight and volume are dimensions but relative is the absence of one -
// see migrations/019_unit_kind.sql.
type UnitKind string

const (
	// KindWeight and KindVolume mark Absolute Units - the same size whatever
	// they measure, so Factor converts them to their dimension's base (gram,
	// millilitre) with no knowledge of the ingredient.
	KindWeight UnitKind = "weight"
	KindVolume UnitKind = "volume"
	// KindRelative marks a Unit whose size depends on the ingredient (a tin, a
	// clove, a bare count). It has no Factor; converting one needs a
	// per-ingredient Unit Size, which arrives in a later phase.
	KindRelative UnitKind = "relative"
)

// UnitInfo is what the Shopping List aggregation needs to know about a Unit.
// Deliberately not in `common`: it's internal to combining a list, and never
// appears in an API response.
//
// Factor is meaningful only for an Absolute Unit, and is always 0 for a
// Relative one - GetUnitCatalog normalises any row whose factor is NULL to
// KindRelative, so an in-memory UnitInfo can't be an Absolute Unit with no way
// to convert it.
type UnitInfo struct {
	Kind   UnitKind
	Factor float64
	// DefaultSize is a Unit Size to fall back on for Relative Units whose size
	// genuinely doesn't vary by Ingredient - a pinch is a pinch. 0 means none,
	// which is the right answer for packet, bottle, slice and the bare count,
	// where the size depends entirely on what's being measured. Always
	// overridden by a Unit Size curated for a specific Ingredient.
	DefaultSize float64
}

// IsAbsolute reports whether one of this Unit is the same size whatever it
// measures, and can therefore be converted using Factor alone. The inverse is a
// Relative Unit, which needs a per-ingredient Unit Size instead.
//
// Use this rather than comparing Kind directly when deciding whether two
// Amounts combine: every Relative Unit shares KindRelative, so a tin and a
// pinch compare equal on Kind despite having nothing to do with each other.
// Two Units combine when both IsAbsolute and their Kinds match.
func (u UnitInfo) IsAbsolute() bool {
	return u.Kind == KindWeight || u.Kind == KindVolume
}

// UnitCatalog maps a Unit's name to its measurement metadata. Keyed by name
// rather than id because that's what a common.Ingredient carries - the id
// isn't plumbed through the recipe payload, and `unit`.`name` is UNIQUE
// (migration 016), so the name is a canonical identity.
type UnitCatalog map[string]UnitInfo

// Get returns the UnitInfo for a Unit name, defaulting to a Relative Unit with
// no Factor when the name is unknown. An unknown Unit is a normal state, not an
// error: Recipe Import can introduce one ("bunch", "sprig") at any time, and
// treating it as Relative is the safe reading - it just won't combine with
// anything until it has a Unit Size.
func (c UnitCatalog) Get(name string) UnitInfo {
	if info, ok := c[name]; ok {
		return info
	}
	return UnitInfo{Kind: KindRelative}
}

// GetUnitCatalog loads every Unit's measurement metadata in one query, for
// passing into CombineIngredients. The aggregation itself stays pure - it takes
// this as an argument and never queries.
func GetUnitCatalog(ctx context.Context, db *sql.DB) (UnitCatalog, error) {
	results, err := db.QueryContext(ctx, "SELECT name, kind, factor, default_size FROM unit;")
	if err != nil {
		return nil, err
	}
	defer results.Close()

	catalog := make(UnitCatalog)
	for results.Next() {
		var name string
		var kind UnitKind
		var factor, defaultSize sql.NullFloat64
		if err := results.Scan(&name, &kind, &factor, &defaultSize); err != nil {
			return nil, err
		}
		// A row claiming to be Absolute with no factor can't actually be
		// converted, so treat it as Relative rather than letting a zero factor
		// silently scale every quantity to nothing. Shouldn't happen - the two
		// are set together in migration 019 and the dev seed - but the whole
		// point of this type is that the aggregator can trust it.
		info := UnitInfo{Kind: kind}
		if factor.Valid {
			info.Factor = factor.Float64
		} else {
			info.Kind = KindRelative
		}
		if defaultSize.Valid {
			info.DefaultSize = defaultSize.Float64
		}
		catalog[name] = info
	}
	if err := results.Err(); err != nil {
		return nil, err
	}
	return catalog, nil
}

// GetAllUnits returns all unit types
func GetAllUnits(ctx context.Context, db *sql.DB) ([]Unit, error) {
	results, err := db.QueryContext(ctx, "SELECT id, name FROM unit order by lower(name);")

	if err != nil {
		return nil, err
	}
	defer results.Close()

	units := make([]Unit, 0)

	for results.Next() {
		r := Unit{}
		if err := results.Scan(&r.ID, &r.Name); err != nil {
			return nil, err
		}
		units = append(units, r)
	}
	if err := results.Err(); err != nil {
		return nil, err
	}
	return units, nil
}
