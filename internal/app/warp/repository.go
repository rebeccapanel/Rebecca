package warp

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

type Account struct {
	ID          int64
	DeviceID    string
	AccessToken string
	LicenseKey  string
	PrivateKey  string
	PublicKey   string
	CreatedAt   string
	UpdatedAt   string
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

func (r Repository) First(ctx context.Context) (*Account, error) {
	row := r.db.QueryRowContext(
		ctx,
		`SELECT id, device_id, access_token, COALESCE(license_key, ''), private_key, COALESCE(public_key, ''), COALESCE(CAST(created_at AS CHAR), ''), COALESCE(CAST(updated_at AS CHAR), '') FROM warp_accounts ORDER BY id ASC LIMIT 1`,
	)
	account, err := scanAccount(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return account, err
}

func (r Repository) Upsert(ctx context.Context, account Account) (*Account, error) {
	existing, err := r.First(ctx)
	if err != nil {
		return nil, err
	}
	now := dbTimestamp(time.Now().UTC())
	if existing == nil {
		result, err := r.db.ExecContext(
			ctx,
			`INSERT INTO warp_accounts (device_id, access_token, license_key, private_key, public_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			account.DeviceID,
			account.AccessToken,
			nullableString(account.LicenseKey),
			account.PrivateKey,
			nullableString(account.PublicKey),
			now,
			now,
		)
		if err != nil {
			return nil, err
		}
		id, _ := result.LastInsertId()
		account.ID = id
		account.CreatedAt = now
		account.UpdatedAt = now
		return &account, nil
	}
	_, err = r.db.ExecContext(
		ctx,
		`UPDATE warp_accounts SET device_id = ?, access_token = ?, license_key = ?, private_key = ?, public_key = ?, updated_at = ? WHERE id = ?`,
		account.DeviceID,
		account.AccessToken,
		nullableString(account.LicenseKey),
		account.PrivateKey,
		nullableString(account.PublicKey),
		now,
		existing.ID,
	)
	if err != nil {
		return nil, err
	}
	return r.First(ctx)
}

func (r Repository) UpdateLicense(ctx context.Context, accountID int64, licenseKey string) (*Account, error) {
	_, err := r.db.ExecContext(ctx, `UPDATE warp_accounts SET license_key = ?, updated_at = ? WHERE id = ?`, nullableString(licenseKey), dbTimestamp(time.Now().UTC()), accountID)
	if err != nil {
		return nil, err
	}
	return r.First(ctx)
}

func (r Repository) DeleteLocal(ctx context.Context) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM warp_accounts`)
	return err
}

type scanner interface {
	Scan(dest ...any) error
}

func scanAccount(row scanner) (*Account, error) {
	var account Account
	if err := row.Scan(
		&account.ID,
		&account.DeviceID,
		&account.AccessToken,
		&account.LicenseKey,
		&account.PrivateKey,
		&account.PublicKey,
		&account.CreatedAt,
		&account.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &account, nil
}

func nullableString(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func dbTimestamp(value time.Time) string {
	return value.UTC().Format("2006-01-02 15:04:05")
}
