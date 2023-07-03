package service

import (
	"database/sql"
	"log"
	"recipes/internal/pkg/common"
)

func AddUser(db *sql.DB, user common.User) error {
	userQuery := `
		INSERT INTO user (id, name, email)
			VALUES (?, ?, ?)
			ON DUPLICATE KEY UPDATE
				id=id,
				name=?,
				email=?,
				last_logged_in_at=CURRENT_TIMESTAMP
			;
	`
	_, err := db.Exec(userQuery, user.ID, user.Name, user.Email, user.Name, user.Email)
	if err != nil {
		log.Println("Error adding user")
		log.Println(err)
		return err
	}
	return nil
}

func GetUser(db *sql.DB, userID string) (u *common.User, e error) {
	userQuery := `SELECT id, name, email FROM user WHERE id = ?`
	user := &common.User{}

	if err := db.QueryRow(userQuery, userID).Scan(&user.ID, &user.Name, &user.Email); err != nil {
		return nil, err
	}
	return user, nil
}
