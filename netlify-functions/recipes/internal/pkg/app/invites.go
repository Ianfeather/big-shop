package app

import (
	"encoding/json"
	"log"
	"net/http"
	"recipes/internal/pkg/service"
)

func (a *App) acceptInvite(w http.ResponseWriter, req *http.Request) {
	currentUser, err := service.GetUser(a.db, req.Context().Value(contextKey("userID")).(string))
	if err != nil {
		log.Println("Error finding current user")
		http.Error(w, "Error finding current user", http.StatusBadRequest)
		return
	}
	var body struct {
		Token string
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		http.Error(w, "Error decoding json body", http.StatusBadRequest)
		return
	}
	accountID, err := service.GetInvite(a.db, body.Token, currentUser.Email)
	if err != nil {
		log.Println("Error finding invite")
		http.Error(w, "Error finding invite", http.StatusBadRequest)
		return
	}

	// Disable old user account
	if err = service.DisableUserAccount(a.db, *currentUser); err != nil {
		http.Error(w, "Error disabling user account", http.StatusInternalServerError)
		return
	}

	// Add user to the account
	if err = service.AddUserToAccount(a.db, *accountID, *currentUser); err != nil {
		http.Error(w, "Error adding user to the account", http.StatusInternalServerError)
		return
	}

	// remove the invite
	if err = service.DeleteInvite(a.db, *accountID, currentUser.Email); err != nil {
		http.Error(w, "Error deleting invite", http.StatusInternalServerError)
		return
	}
}

func (a *App) getInvites(w http.ResponseWriter, req *http.Request) {
	user, err := service.GetUser(a.db, req.Context().Value(contextKey("userID")).(string))
	if err != nil {
		log.Println("Error finding current user")
		http.Error(w, "Error finding current user", http.StatusInternalServerError)
		return
	}
	invites, err := service.GetInvites(a.db, user.Email)
	if err != nil {
		log.Println("Error finding invites")
		http.Error(w, "Error finding invites", http.StatusNotFound)
		return
	}

	encoder := json.NewEncoder(w)
	if err = encoder.Encode(invites); err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
	}
}

func (a *App) rejectInvite(w http.ResponseWriter, req *http.Request) {
	var body struct {
		Token string
	}
	if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
		http.Error(w, "Error decoding json body", http.StatusBadRequest)
		return
	}
	if err := service.DeleteInviteByToken(a.db, body.Token); err != nil {
		http.Error(w, "Error deleting invite", http.StatusInternalServerError)
		return
	}
}
