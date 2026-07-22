package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type Queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type Execer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

type DBTX interface {
	Queryer
	Execer
}

func HasTable(ctx context.Context, db Queryer, dialect string, table string) (bool, error) {
	table = strings.TrimSpace(table)
	if table == "" {
		return false, fmt.Errorf("table name is empty")
	}
	var exists int
	var err error
	switch NormalizeDialect(dialect) {
	case "sqlite":
		err = db.QueryRowContext(ctx, `SELECT COUNT(1) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&exists)
	case "mysql":
		err = db.QueryRowContext(ctx, `SELECT COUNT(1) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`, table).Scan(&exists)
	default:
		return false, fmt.Errorf("unsupported dialect: %s", dialect)
	}
	return exists > 0, err
}

func HasColumn(ctx context.Context, db Queryer, dialect string, table string, column string) (bool, error) {
	table = strings.TrimSpace(table)
	column = strings.TrimSpace(column)
	if table == "" || column == "" {
		return false, fmt.Errorf("table and column are required")
	}
	switch NormalizeDialect(dialect) {
	case "sqlite":
		rows, err := db.QueryContext(ctx, `PRAGMA table_info(`+QuoteIdent("sqlite", table)+`)`)
		if err != nil {
			return false, err
		}
		defer rows.Close()
		for rows.Next() {
			var cid int
			var name, typ string
			var notNull int
			var defaultValue any
			var pk int
			if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
				return false, err
			}
			if strings.EqualFold(name, column) {
				return true, nil
			}
		}
		return false, rows.Err()
	case "mysql":
		var exists int
		err := db.QueryRowContext(ctx, `SELECT COUNT(1) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, table, column).Scan(&exists)
		return exists > 0, err
	default:
		return false, fmt.Errorf("unsupported dialect: %s", dialect)
	}
}

func HasIndex(ctx context.Context, db Queryer, dialect string, table string, index string) (bool, error) {
	table = strings.TrimSpace(table)
	index = strings.TrimSpace(index)
	if table == "" || index == "" {
		return false, fmt.Errorf("table and index are required")
	}
	switch NormalizeDialect(dialect) {
	case "sqlite":
		var exists int
		err := db.QueryRowContext(ctx, `SELECT COUNT(1) FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name = ?`, table, index).Scan(&exists)
		return exists > 0, err
	case "mysql":
		var exists int
		err := db.QueryRowContext(ctx, `SELECT COUNT(1) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`, table, index).Scan(&exists)
		return exists > 0, err
	default:
		return false, fmt.Errorf("unsupported dialect: %s", dialect)
	}
}

func AddColumnIfMissing(ctx context.Context, db DBTX, dialect string, table string, column string, definition string) (bool, error) {
	exists, err := HasColumn(ctx, db, dialect, table, column)
	if err != nil {
		return false, err
	}
	if exists {
		return false, nil
	}
	query := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", QuoteIdent(dialect, table), QuoteIdent(dialect, column), strings.TrimSpace(definition))
	_, err = db.ExecContext(ctx, query)
	return true, err
}

func DropColumnIfExists(ctx context.Context, db DBTX, dialect string, table string, column string) (bool, error) {
	exists, err := HasColumn(ctx, db, dialect, table, column)
	if err != nil {
		return false, err
	}
	if !exists {
		return false, nil
	}
	query := fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", QuoteIdent(dialect, table), QuoteIdent(dialect, column))
	_, err = db.ExecContext(ctx, query)
	return true, err
}

func CreateIndexIfMissing(ctx context.Context, db DBTX, dialect string, table string, index string, columns []string, unique bool) (bool, error) {
	exists, err := HasIndex(ctx, db, dialect, table, index)
	if err != nil {
		return false, err
	}
	if exists {
		return false, nil
	}
	if len(columns) == 0 {
		return false, fmt.Errorf("index columns are required")
	}
	quoted := make([]string, 0, len(columns))
	for _, column := range columns {
		quoted = append(quoted, QuoteIdent(dialect, column))
	}
	uniqueSQL := ""
	if unique {
		uniqueSQL = "UNIQUE "
	}
	query := fmt.Sprintf("CREATE %sINDEX %s ON %s (%s)", uniqueSQL, QuoteIdent(dialect, index), QuoteIdent(dialect, table), strings.Join(quoted, ", "))
	_, err = db.ExecContext(ctx, query)
	return true, err
}

func DropIndexIfExists(ctx context.Context, db DBTX, dialect string, table string, index string) (bool, error) {
	exists, err := HasIndex(ctx, db, dialect, table, index)
	if err != nil {
		return false, err
	}
	if !exists {
		return false, nil
	}
	var query string
	switch NormalizeDialect(dialect) {
	case "mysql":
		query = fmt.Sprintf("DROP INDEX %s ON %s", QuoteIdent(dialect, index), QuoteIdent(dialect, table))
	case "sqlite":
		query = fmt.Sprintf("DROP INDEX %s", QuoteIdent(dialect, index))
	default:
		return false, fmt.Errorf("unsupported dialect: %s", dialect)
	}
	_, err = db.ExecContext(ctx, query)
	return true, err
}

func CreateTableIfMissing(ctx context.Context, db DBTX, dialect string, table string, createSQL string) (bool, error) {
	exists, err := HasTable(ctx, db, dialect, table)
	if err != nil {
		return false, err
	}
	if exists {
		return false, nil
	}
	_, err = db.ExecContext(ctx, createSQL)
	return true, err
}

type SQLiteColumnRewrite struct {
	Type        string
	NotNull     *bool
	Default     *string
	DropDefault bool
}

type sqliteColumnInfo struct {
	Name       string
	Type       string
	NotNull    bool
	Default    sql.NullString
	PrimaryKey bool
}

func RewriteSQLiteTableColumns(ctx context.Context, db DBTX, table string, rewrites map[string]SQLiteColumnRewrite) error {
	if len(rewrites) == 0 {
		return nil
	}
	columns, err := sqliteTableColumns(ctx, db, table)
	if err != nil {
		return err
	}
	if len(columns) == 0 {
		return nil
	}
	indexes, err := sqliteIndexSQL(ctx, db, table)
	if err != nil {
		return err
	}

	tempTable := fmt.Sprintf("__goose_rebuild_%s_%d", table, time.Now().UnixNano())
	if _, err := db.ExecContext(ctx, fmt.Sprintf("DROP TABLE IF EXISTS %s", QuoteIdent("sqlite", tempTable))); err != nil {
		return err
	}
	definitions := make([]string, 0, len(columns))
	names := make([]string, 0, len(columns))
	for _, column := range columns {
		names = append(names, column.Name)
		definitions = append(definitions, sqliteColumnDefinition(column, rewrites[column.Name]))
	}
	if _, err := db.ExecContext(ctx, fmt.Sprintf("CREATE TABLE %s (%s)", QuoteIdent("sqlite", tempTable), strings.Join(definitions, ", "))); err != nil {
		return err
	}
	quotedNames := quoteList("sqlite", names)
	if _, err := db.ExecContext(
		ctx,
		fmt.Sprintf(
			"INSERT INTO %s (%s) SELECT %s FROM %s",
			QuoteIdent("sqlite", tempTable),
			quotedNames,
			quotedNames,
			QuoteIdent("sqlite", table),
		),
	); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, fmt.Sprintf("DROP TABLE %s", QuoteIdent("sqlite", table))); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, fmt.Sprintf("ALTER TABLE %s RENAME TO %s", QuoteIdent("sqlite", tempTable), QuoteIdent("sqlite", table))); err != nil {
		return err
	}
	for _, indexSQL := range indexes {
		if strings.TrimSpace(indexSQL) == "" {
			continue
		}
		if _, err := db.ExecContext(ctx, indexSQL); err != nil {
			return err
		}
	}
	return nil
}

func sqliteTableColumns(ctx context.Context, db Queryer, table string) ([]sqliteColumnInfo, error) {
	rows, err := db.QueryContext(ctx, `PRAGMA table_info(`+QuoteIdent("sqlite", table)+`)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var columns []sqliteColumnInfo
	for rows.Next() {
		var cid int
		var column sqliteColumnInfo
		var notNull int
		var defaultValue any
		var primaryKey int
		if err := rows.Scan(&cid, &column.Name, &column.Type, &notNull, &defaultValue, &primaryKey); err != nil {
			return nil, err
		}
		column.NotNull = notNull != 0
		column.PrimaryKey = primaryKey != 0
		if defaultValue != nil {
			switch value := defaultValue.(type) {
			case []byte:
				column.Default = sql.NullString{String: string(value), Valid: true}
			default:
				column.Default = sql.NullString{String: fmt.Sprint(value), Valid: true}
			}
		}
		columns = append(columns, column)
	}
	return columns, rows.Err()
}

func sqliteIndexSQL(ctx context.Context, db Queryer, table string) ([]string, error) {
	rows, err := db.QueryContext(ctx, `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL ORDER BY name`, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var indexes []string
	for rows.Next() {
		var sqlText string
		if err := rows.Scan(&sqlText); err != nil {
			return nil, err
		}
		indexes = append(indexes, sqlText)
	}
	return indexes, rows.Err()
}

func sqliteColumnDefinition(column sqliteColumnInfo, rewrite SQLiteColumnRewrite) string {
	columnType := strings.TrimSpace(column.Type)
	if rewrite.Type != "" {
		columnType = strings.TrimSpace(rewrite.Type)
	}
	parts := []string{QuoteIdent("sqlite", column.Name)}
	if columnType != "" {
		parts = append(parts, columnType)
	}
	if column.PrimaryKey {
		parts = append(parts, "PRIMARY KEY")
	} else {
		notNull := column.NotNull
		if rewrite.NotNull != nil {
			notNull = *rewrite.NotNull
		}
		if notNull {
			parts = append(parts, "NOT NULL")
		}
	}
	if rewrite.Default != nil {
		parts = append(parts, "DEFAULT "+*rewrite.Default)
	} else if !rewrite.DropDefault && column.Default.Valid {
		parts = append(parts, "DEFAULT "+column.Default.String)
	}
	return strings.Join(parts, " ")
}

func ExecDialect(ctx context.Context, db Execer, dialect string, sqliteSQL string, mysqlSQL string, args ...any) (sql.Result, error) {
	switch NormalizeDialect(dialect) {
	case "sqlite":
		if strings.TrimSpace(sqliteSQL) == "" {
			return nil, fmt.Errorf("sqlite SQL is empty")
		}
		return db.ExecContext(ctx, sqliteSQL, args...)
	case "mysql":
		if strings.TrimSpace(mysqlSQL) == "" {
			return nil, fmt.Errorf("mysql SQL is empty")
		}
		return db.ExecContext(ctx, mysqlSQL, args...)
	default:
		return nil, fmt.Errorf("unsupported dialect: %s", dialect)
	}
}

type SQLiteRebuildSpec struct {
	Table          string
	CreateSQL      string
	Columns        []string
	SelectColumns  []string
	DisableForeign bool
}

func RebuildSQLiteTable(ctx context.Context, db *sql.DB, spec SQLiteRebuildSpec) error {
	if strings.TrimSpace(spec.Table) == "" || strings.TrimSpace(spec.CreateSQL) == "" || len(spec.Columns) == 0 {
		return fmt.Errorf("table, create SQL, and columns are required")
	}
	selectColumns := spec.SelectColumns
	if len(selectColumns) == 0 {
		selectColumns = spec.Columns
	}
	if len(selectColumns) != len(spec.Columns) {
		return fmt.Errorf("select columns must match destination columns")
	}

	oldTable := fmt.Sprintf("%s__goose_rebuild_%d", spec.Table, time.Now().UnixNano())
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if spec.DisableForeign {
		if _, err := tx.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, fmt.Sprintf("ALTER TABLE %s RENAME TO %s", QuoteIdent("sqlite", spec.Table), QuoteIdent("sqlite", oldTable))); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, spec.CreateSQL); err != nil {
		return err
	}
	dst := quoteList("sqlite", spec.Columns)
	src := quoteList("sqlite", selectColumns)
	if _, err := tx.ExecContext(ctx, fmt.Sprintf("INSERT INTO %s (%s) SELECT %s FROM %s", QuoteIdent("sqlite", spec.Table), dst, src, QuoteIdent("sqlite", oldTable))); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, fmt.Sprintf("DROP TABLE %s", QuoteIdent("sqlite", oldTable))); err != nil {
		return err
	}
	if spec.DisableForeign {
		if _, err := tx.ExecContext(ctx, `PRAGMA foreign_keys = ON`); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func QuoteIdent(dialect string, ident string) string {
	parts := strings.Split(strings.TrimSpace(ident), ".")
	for i, part := range parts {
		part = strings.TrimSpace(part)
		switch NormalizeDialect(dialect) {
		case "mysql":
			parts[i] = "`" + strings.ReplaceAll(part, "`", "``") + "`"
		default:
			parts[i] = `"` + strings.ReplaceAll(part, `"`, `""`) + `"`
		}
	}
	return strings.Join(parts, ".")
}

func quoteList(dialect string, values []string) string {
	quoted := make([]string, 0, len(values))
	for _, value := range values {
		quoted = append(quoted, QuoteIdent(dialect, value))
	}
	return strings.Join(quoted, ", ")
}
