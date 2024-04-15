package app

import (
	"log"
	"recipes/internal/pkg/service"

	"database/sql"
	"encoding/json"
	"net/http"
)

func (a *App) getTagsHandler(w http.ResponseWriter, req *http.Request) {
	encoder := json.NewEncoder(w)
	tags, err := service.GetAllTags(a.db)

	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "Tags not found", http.StatusNotFound)
			err = encoder.Encode(make([]string, 0))
			return
		}
		log.Println(err)
		http.Error(w, "Failed to get Tags from db", http.StatusInternalServerError)
		return
	}

	err = encoder.Encode(tags)
	if err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
	}
}
