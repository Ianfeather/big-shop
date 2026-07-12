package service

import (
	"database/sql"
)

// Unit is used to constrain ingredients
type Unit struct {
	Name       string  `json:"name"`
	ID         int     `json:"id"`
	Type       string  `json:"type,omitempty"`
	BaseFactor float64 `json:"baseFactor,omitempty"`
}

// GetAllUnits returns all unit types
func GetAllUnits(db *sql.DB) ([]Unit, error) {
	results, err := db.Query("SELECT id, name, unit_type, base_factor FROM unit order by lower(name);")

	if err != nil {
		return nil, err
	}

	units := make([]Unit, 0)

	for results.Next() {
		r := Unit{}
		err = results.Scan(&r.ID, &r.Name, &r.Type, &r.BaseFactor)
		if err != nil {
			return nil, err
		}
		units = append(units, r)
	}
	return units, nil
}
