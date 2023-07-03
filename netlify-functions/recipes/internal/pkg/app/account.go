package app

import (
	"log"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/service"

	"database/sql"
	"encoding/json"
	"net/http"
)

func (a *App) getAccount(w http.ResponseWriter, req *http.Request) {
	encoder := json.NewEncoder(w)
	userID := req.Context().Value(contextKey("userID")).(string)
	account, err := service.GetAccount(a.db, userID)

	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "Account not found", http.StatusNotFound)
			err = encoder.Encode(make([]string, 0))
			return
		}
		log.Println(err)
		http.Error(w, "Failed to get Account from db", http.StatusInternalServerError)
		return
	}

	err = encoder.Encode(account)
	if err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
	}
}

func (a *App) addUserToAccount(w http.ResponseWriter, req *http.Request) {
	encoder := json.NewEncoder(w)
	userID := req.Context().Value(contextKey("userID")).(string)

	newUser := common.User{}

	if err := json.NewDecoder(req.Body).Decode(&newUser); err != nil {
		http.Error(w, "Error decoding json body", http.StatusBadRequest)
		return
	}

	accountID, err := service.GetAccountID(a.db, userID)

	if err != nil {
		log.Println("Error: current user is not associated with an account")
		http.Error(w, "Current user is not associated with an account", http.StatusInternalServerError)
		return
	}

	// TODO: Fetch the user ID associated with the email from Auth0
	newUser.ID = "12345"
	newUser.Name = "Anna Feather"

	// TODO: if the user doesn't exist, we should be able to invite them
	err = service.AddUserToAccount(a.db, accountID, newUser)

	if err != nil {
		log.Println("failed to add user to account")
		http.Error(w, "Failed to add user to account", http.StatusInternalServerError)
		return
	}

	// return the account object
	account, err := service.GetAccount(a.db, userID)
	err = encoder.Encode(account)
}

func (a *App) removeUserFromAccount(w http.ResponseWriter, req *http.Request) {
	encoder := json.NewEncoder(w)
	userID := req.Context().Value(contextKey("userID")).(string)

	outgoingUser := common.User{}

	if err := json.NewDecoder(req.Body).Decode(&outgoingUser); err != nil {
		http.Error(w, "Error decoding json body", http.StatusBadRequest)
		return
	}

	accountID, err := service.GetAccountID(a.db, userID)

	if err != nil {
		log.Println("Error: current user is not associated with an account")
		http.Error(w, "Current user is not associated with an account", http.StatusInternalServerError)
		return
	}

	// TODO: create the concept of admins
	err = service.RemoveUserFromAccount(a.db, accountID, outgoingUser)

	if err != nil {
		log.Println("failed to remove user frorm account")
		http.Error(w, "Failed to remove user frorm account", http.StatusInternalServerError)
		return
	}

	// return the account object
	account, err := service.GetAccount(a.db, userID)
	err = encoder.Encode(account)
}
