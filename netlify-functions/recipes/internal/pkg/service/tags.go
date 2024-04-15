package service

import (
	"database/sql"
)

// Tag is used to constrain ingredients
type Tag struct {
	Name string `json:"name"`
	ID   int    `json:"id"`
}

// GetAllTags returns all tags
func GetAllTags(db *sql.DB) ([]Tag, error) {
	results, err := db.Query("SELECT name FROM tag order by lower(name);")

	if err != nil {
		return nil, err
	}

	tags := []Tag{}

	for results.Next() {
		r := Tag{}
		err = results.Scan(&r.ID, &r.Name)
		if err != nil {
			return nil, err
		}
		tags = append(tags, r)
	}
	return tags, nil
}
