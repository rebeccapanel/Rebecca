package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000069_admin_host_preferences.go", up000069AdminHostPreferences, emptyDown)
}

// up000069AdminHostPreferences adds the per-admin "MyHosts" overrides. The
// column stays NULL for every admin who never customised their hosts (or who
// reset them), so subscriptions for those admins skip the feature entirely.
func up000069AdminHostPreferences(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	_, err := AddColumnIfMissing(ctx, tx, dialect, "admins", "host_preferences", definitionForDialect(dialect, "TEXT NULL", "JSON NULL"))
	return err
}
