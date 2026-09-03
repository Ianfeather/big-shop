package service

import (
	"context"
	"database/sql"
)

// GetAllTags returns all tags
func GetAllTags(ctx context.Context, db *sql.DB) ([]string, error) {
	results, err := db.QueryContext(ctx, "SELECT name FROM tag order by lower(name);")

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
