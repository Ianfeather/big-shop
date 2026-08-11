package service

import (
	"context"
	"database/sql"
	"fmt"
	"recipes/internal/pkg/common"
	"time"
)

func CreateInvite(ctx context.Context, db *sql.DB, token string, accountID int, email string, userID string) error {
	inviteQuery := `
		INSERT INTO invite (token, account, email, admin_id, expires)
			VALUES (?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE email=email;
	`

	_, err := db.ExecContext(ctx, inviteQuery, token, accountID, email, userID, time.Now().AddDate(0, 0, 30))
	if err != nil {
		return fmt.Errorf("adding invite: %w", err)
	}
	return nil
}

func GetInvites(ctx context.Context, db *sql.DB, email string) (i []common.Invite, e error) {
	query := `
		SELECT token, name
			FROM invite
			LEFT JOIN user on user.id = invite.admin_id
			WHERE invite.email = ? AND invite.expires > ?;`

	results, err := db.QueryContext(ctx, query, email, time.Now())

	if err != nil {
		return nil, fmt.Errorf("querying invites: %w", err)
	}
	defer results.Close()

	invites := make([]common.Invite, 0)

	for results.Next() {
		invite := common.Invite{}
		err = results.Scan(&invite.Token, &invite.AccountHolder)
		if err != nil {
			return nil, err
		}
		invites = append(invites, invite)
	}
	if err := results.Err(); err != nil {
		return nil, err
	}
	return invites, nil

}

func GetInvite(ctx context.Context, db *sql.DB, token string, email string) (a *int, e error) {
	var accountID int
	inviteQuery := `SELECT account from invite WHERE email = ? and token = ?;`
	if err := db.QueryRowContext(ctx, inviteQuery, email, token).Scan(&accountID); err != nil {
		return nil, fmt.Errorf("querying invite: %w", err)
	}
	return &accountID, nil
}

func DeleteInvite(ctx context.Context, db *sql.DB, accountID int, email string) error {
	inviteQuery := `DELETE from invite WHERE account = ? and email = ?;`
	_, err := db.ExecContext(ctx, inviteQuery, accountID, email)
	if err != nil {
		return fmt.Errorf("deleting invite: %w", err)
	}
	return nil
}

func DeleteInviteByToken(ctx context.Context, db *sql.DB, token string) error {
	inviteQuery := `DELETE from invite WHERE token = ?;`
	_, err := db.ExecContext(ctx, inviteQuery, token)
	if err != nil {
		return fmt.Errorf("deleting invite: %w", err)
	}
	return nil
}
