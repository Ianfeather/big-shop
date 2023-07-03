package service

import (
	"database/sql"
	"fmt"
	"log"
	"recipes/internal/pkg/common"
	"time"
)

func CreateInvite(db *sql.DB, token string, accountID int, email string, userID string) error {
	inviteQuery := `
		INSERT INTO invite (token, account, email, admin_id, expires)
			VALUES (?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE email=email;
	`

	_, err := db.Exec(inviteQuery, token, accountID, email, userID, time.Now().AddDate(0, 0, 30))
	if err != nil {
		log.Println("Error adding invite")
		log.Println(err)
		return err
	}
	return nil
}

func GetInvites(db *sql.DB, email string) (i []common.Invite, e error) {
	query := `
		SELECT token, name
			FROM invite
			LEFT JOIN user on user.id = invite.admin_id
			WHERE invite.email = ? AND invite.expires > ?;`

	results, err := db.Query(query, email, time.Now())

	if err != nil {
		log.Println("Error querying invites")
		log.Println(err)
		return nil, err
	}

	invites := make([]common.Invite, 0)

	for results.Next() {
		invite := common.Invite{}
		err = results.Scan(&invite.Token, &invite.AccountHolder)
		if err != nil {
			return nil, err
		}
		invites = append(invites, invite)
	}
	return invites, nil

}

func GetInvite(db *sql.DB, token string, email string) (a *int, e error) {
	var accountID int
	fmt.Println(email)
	fmt.Println(token)
	inviteQuery := `SELECT account from invite WHERE email = ? and token = ?;`
	if err := db.QueryRow(inviteQuery, email, token).Scan(&accountID); err != nil {
		log.Println("Error querying invite")
		log.Println(err)
		return nil, err
	}
	return &accountID, nil
}

func DeleteInvite(db *sql.DB, accountID int, email string) error {
	inviteQuery := `DELETE from invite WHERE account = ? and email = ?;`
	_, err := db.Exec(inviteQuery, accountID, email)
	if err != nil {
		log.Println("Error deleting invite")
		log.Println(err)
		return err
	}
	return nil
}

func DeleteInviteByToken(db *sql.DB, token string) error {
	inviteQuery := `DELETE from invite WHERE token = ?;`
	_, err := db.Exec(inviteQuery, token)
	if err != nil {
		log.Println("Error deleting invite")
		log.Println(err)
		return err
	}
	return nil
}
