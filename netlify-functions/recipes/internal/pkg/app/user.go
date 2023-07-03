package app

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"recipes/internal/pkg/common"
	"recipes/internal/pkg/service"

	"github.com/sendgrid/sendgrid-go"
	"github.com/sendgrid/sendgrid-go/helpers/mail"
)

func (a *App) addUser(w http.ResponseWriter, req *http.Request) {
	encoder := json.NewEncoder(w)
	user := common.User{}
	if err := json.NewDecoder(req.Body).Decode(&user); err != nil {
		http.Error(w, "Error decoding json body", http.StatusBadRequest)
		return
	}

	user.ID = req.Context().Value(contextKey("userID")).(string)

	err := service.AddUser(a.db, user)
	if err != nil {
		log.Println("Error: could not add new user")
		http.Error(w, "could not add new user", http.StatusInternalServerError)
		return
	}
	err = service.CreateAccount(a.db, user)
	if err != nil {
		log.Println("Error creating account for user")
		http.Error(w, "Error creating account for user", http.StatusInternalServerError)
		return
	}
	err = encoder.Encode(user)
	if err != nil {
		http.Error(w, "Error encoding json", http.StatusInternalServerError)
	}
}

func (a *App) inviteUser(w http.ResponseWriter, req *http.Request) {
	currentUserID := req.Context().Value(contextKey("userID")).(string)
	userToInvite := common.User{}
	if err := json.NewDecoder(req.Body).Decode(&userToInvite); err != nil {
		http.Error(w, "Error decoding json body", http.StatusBadRequest)
		return
	}
	currentUser, err := service.GetUser(a.db, currentUserID)
	if err != nil {
		log.Println("Error finding current user")
		http.Error(w, "Error finding current user", http.StatusBadRequest)
		return
	}
	account, err := service.GetAccount(a.db, currentUserID)
	if err != nil {
		log.Println("Error finding account for current user")
		http.Error(w, "Error finding account for current user", http.StatusBadRequest)
		return
	}

	// Generate a token and write it to the invites table
	token, _ := common.RandToken(32)
	if err = service.CreateInvite(a.db, token, account.ID, userToInvite.Email, currentUserID); err != nil {
		log.Println("Error creating Invite")
		http.Error(w, "Error creating Invite", http.StatusInternalServerError)
		return
	}

	// Send the email
	from := mail.NewEmail("Ian Feather", "info@ianfeather.co.uk")
	subject := "You have been invited to join a BigShop Account"
	to := mail.NewEmail("BigShop User", userToInvite.Email)
	htmlContent := `
    <p>You have been invited to collaborate on a BigShop account by %s!</p>
    <p>You can accept this by clicking below:</p>
    <a href="https://pleeyu7yrd.execute-api.us-east-1.amazonaws.com/prod/invitation/%s">Accept invite</a>
  `
	message := mail.NewSingleEmail(from, subject, to, "", fmt.Sprintf(htmlContent, currentUser.Name, token))
	client := sendgrid.NewSendClient(os.Getenv("SENDGRID_API_KEY"))
	_, err = client.Send(message)
	if err != nil {
		log.Println(err)
		http.Error(w, "Error sending email", http.StatusBadRequest)
		return
	}
}
