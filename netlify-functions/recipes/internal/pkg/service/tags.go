package service

import (
	"database/sql"
)

// GetAllTags returns all tags
func GetAllTags(db *sql.DB) ([]string, error) {
	results, err := db.Query("SELECT name FROM tag order by lower(name);")

	if err != nil {
		return nil, err
	}
	defer results.Close()

	tags := []string{}

	for results.Next() {
		var tag string
		err = results.Scan(&tag)
		if err != nil {
			return nil, err
		}
		tags = append(tags, tag)
	}
	if err := results.Err(); err != nil {
		return nil, err
	}
	return tags, nil
}
