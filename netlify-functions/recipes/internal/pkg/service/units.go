package service

import (
	"database/sql"
)

// Unit is used to constrain ingredients
type Unit struct {
	Name string `json:"name"`
	ID   int    `json:"id"`
}

// Unit kinds, mirroring the `unit`.`kind` enum. Named "kind" rather than
// "dimension" because weight and volume are dimensions but relative is the
// absence of one - see migrations/019_unit_kind.sql.
const (
	// KindWeight and KindVolume mark Absolute Units - the same size whatever
	// they measure, so Factor converts them to their dimension's base (gram,
	// millilitre) with no knowledge of the ingredient.
	KindWeight = "weight"
	KindVolume = "volume"
	// KindRelative marks a Unit whose size depends on the ingredient (a tin, a
	// clove, a bare count). It has no Factor; converting one needs a
	// per-ingredient Unit Size, which arrives in a later phase.
	KindRelative = "relative"
)

// UnitInfo is what the Shopping List aggregation needs to know about a Unit.
// Deliberately not in `common`: it's internal to combining a list, and never
// appears in an API response.
//
// Note that comparing two UnitInfos' Kind is only meaningful for Absolute
// Units: every Relative Unit shares KindRelative, so a tin and a pinch would
// compare equal. Callers deciding whether two Amounts can be summed must check
// Factor.Valid as well, not Kind alone.
type UnitInfo struct {
	Kind   string
	Factor sql.NullFloat64
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
func GetUnitCatalog(db *sql.DB) (UnitCatalog, error) {
	results, err := db.Query("SELECT name, kind, factor FROM unit;")
	if err != nil {
		return nil, err
	}
	defer results.Close()

	catalog := make(UnitCatalog)
	for results.Next() {
		var name string
		var info UnitInfo
		if err := results.Scan(&name, &info.Kind, &info.Factor); err != nil {
			return nil, err
		}
		catalog[name] = info
	}
	if err := results.Err(); err != nil {
		return nil, err
	}
	return catalog, nil
}

// GetAllUnits returns all unit types
func GetAllUnits(db *sql.DB) ([]Unit, error) {
	results, err := db.Query("SELECT id, name FROM unit order by lower(name);")

	if err != nil {
		return nil, err
	}

	units := make([]Unit, 0)

	for results.Next() {
		r := Unit{}
		err = results.Scan(&r.ID, &r.Name)
		if err != nil {
			return nil, err
		}
		units = append(units, r)
	}
	return units, nil
}
