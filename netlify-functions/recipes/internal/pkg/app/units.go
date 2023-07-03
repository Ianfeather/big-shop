package app

import (
	"log"
	"recipes/internal/pkg/service"

	"database/sql"
	"encoding/json"
	"net/http"
)

func (a *App) getUnitsHandler(w http.ResponseWriter, req *http.Request) {
	encoder := json.NewEncoder(w)
	units, err := service.GetAllUnits(a.db)

	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "Units not found", http.StatusNotFound)
			err = encoder.Encode(make([]string, 0))
			return
		}
		log.Println(err)
		http.Error(w, "Failed to get Units from db", http.StatusInternalServerError)
		return
	}

	err = encoder.Encode(units)
	if err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
	}
}
