package nordvpn

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

type Data struct {
	ID         int64
	Token      string
	PrivateKey string
	CreatedAt  string
	UpdatedAt  string
}

type Repository struct {
	db      *sql.DB
	dialect string
}

func NewRepository(db *sql.DB, dialect string) Repository {
	if strings.TrimSpace(dialect) == "" {
		dialect = "sqlite"
	}
	return Repository{db: db, dialect: strings.ToLower(dialect)}
}

func (r Repository) First(ctx context.Context) (*Data, error) {
	row := r.db.QueryRowContext(
		ctx,
		`SELECT id, COALESCE(token, ''), COALESCE(private_key, ''), COALESCE(CAST(created_at AS CHAR), ''), COALESCE(CAST(updated_at AS CHAR), '') FROM nordvpn_settings ORDER BY id ASC LIMIT 1`,
	)
	var data Data
	if err := row.Scan(&data.ID, &data.Token, &data.PrivateKey, &data.CreatedAt, &data.UpdatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if strings.TrimSpace(data.PrivateKey) == "" && strings.TrimSpace(data.Token) == "" {
		return nil, nil
	}
	return &data, nil
}

func (r Repository) Upsert(ctx context.Context, data Data) (*Data, error) {
	now := dbTimestamp(time.Now().UTC())
	existing, err := r.First(ctx)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		result, err := r.db.ExecContext(
			ctx,
			`INSERT INTO nordvpn_settings (token, private_key, created_at, updated_at) VALUES (?, ?, ?, ?)`,
			strings.TrimSpace(data.Token),
			strings.TrimSpace(data.PrivateKey),
			now,
			now,
		)
		if err != nil {
			return nil, err
		}
		id, _ := result.LastInsertId()
		data.ID = id
		data.CreatedAt = now
		data.UpdatedAt = now
		return &data, nil
	}
	_, err = r.db.ExecContext(
		ctx,
		`UPDATE nordvpn_settings SET token = ?, private_key = ?, updated_at = ? WHERE id = ?`,
		strings.TrimSpace(data.Token),
		strings.TrimSpace(data.PrivateKey),
		now,
		existing.ID,
	)
	if err != nil {
		return nil, err
	}
	return r.First(ctx)
}

func (r Repository) Delete(ctx context.Context) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM nordvpn_settings`)
	return err
}

func dbTimestamp(value time.Time) string {
	return value.UTC().Format("2006-01-02 15:04:05")
}
