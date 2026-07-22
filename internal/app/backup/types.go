package backup

import "time"

const (
	Format    = "rebecca-backup"
	Version   = 1
	Extension = ".rbbackup"
	MediaType = "application/vnd.rebecca.backup"

	ScopeDatabase = "database"
	ScopeFull     = "full"

	ManifestName       = "manifest.json"
	DatabaseDumpName   = "database.json"
	DatabaseSQLiteName = "database.sqlite3"
	DatabaseSQLName    = "database.sql"
	FilesPrefix        = "files"

	DisabledDetail = "Rebecca backup and import is available only on binary installations. Migrate this panel to the binary version before using backup or restore from the web UI."
)

type Error struct {
	Message string
}

func (e Error) Error() string {
	return e.Message
}

type FileRoot struct {
	ArchiveName string
	Path        string
}

type ExportResult struct {
	Path     string
	Filename string
	Scope    string
}

type ImportResult struct {
	Scope          string   `json:"scope"`
	TablesRestored int      `json:"tables_restored"`
	RowsRestored   int      `json:"rows_restored"`
	FilesRestored  []string `json:"files_restored"`
	Warnings       []string `json:"warnings"`
}

type databasePayload struct {
	ArchiveName string
	PayloadType string
}

type manifest struct {
	Format    string         `json:"format"`
	Version   int            `json:"version"`
	Scope     string         `json:"scope"`
	CreatedAt string         `json:"created_at"`
	Database  manifestDB     `json:"database"`
	Paths     []manifestPath `json:"paths"`
}

type manifestDB struct {
	URLDialect       string `json:"url_dialect"`
	SourceURLDialect string `json:"source_url_dialect"`
	Payload          string `json:"payload"`
	PayloadType      string `json:"payload_type"`
	Tables           int    `json:"tables"`
	Rows             int    `json:"rows"`
}

type manifestPath struct {
	ArchiveName string `json:"archive_name"`
	Path        string `json:"path"`
}

func utcNowString() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}
