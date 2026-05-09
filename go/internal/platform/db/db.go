package db

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-sql-driver/mysql"
	_ "github.com/mattn/go-sqlite3"
)

type Pool struct {
	DB      *sql.DB
	Dialect string
}

var (
	mu    sync.Mutex
	pools = map[string]Pool{}
)

func Open(databaseURL string) (Pool, error) {
	databaseURL = strings.TrimSpace(databaseURL)
	if databaseURL == "" {
		return Pool{}, fmt.Errorf("database url is empty")
	}

	mu.Lock()
	if pool, ok := pools[databaseURL]; ok {
		mu.Unlock()
		return pool, nil
	}
	mu.Unlock()

	driver, dsn, dialect, err := parseDatabaseURL(databaseURL)
	if err != nil {
		return Pool{}, err
	}

	sqlDB, err := sql.Open(driver, dsn)
	if err != nil {
		return Pool{}, err
	}

	if dialect == "sqlite" {
		sqlDB.SetMaxOpenConns(1)
		sqlDB.SetMaxIdleConns(1)
	} else {
		sqlDB.SetMaxOpenConns(10)
		sqlDB.SetMaxIdleConns(5)
		sqlDB.SetConnMaxLifetime(time.Hour)
	}

	pingCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(pingCtx); err != nil {
		sqlDB.Close()
		return Pool{}, err
	}

	pool := Pool{DB: sqlDB, Dialect: dialect}

	mu.Lock()
	pools[databaseURL] = pool
	mu.Unlock()

	return pool, nil
}

func parseDatabaseURL(databaseURL string) (driver string, dsn string, dialect string, err error) {
	switch {
	case strings.HasPrefix(databaseURL, "sqlite:///"):
		path := strings.TrimPrefix(databaseURL, "sqlite:///")
		if path == "" {
			return "", "", "", fmt.Errorf("sqlite database path is empty")
		}
		return "sqlite3", sqliteDSN(path), "sqlite", nil
	case strings.HasPrefix(databaseURL, "sqlite://"):
		parsed, parseErr := url.Parse(databaseURL)
		if parseErr != nil {
			return "", "", "", parseErr
		}
		path := parsed.Path
		if path == "" {
			return "", "", "", fmt.Errorf("sqlite database path is empty")
		}
		return "sqlite3", sqliteDSN(path), "sqlite", nil
	default:
		return parseMySQLURL(databaseURL)
	}
}

func sqliteDSN(path string) string {
	if strings.HasPrefix(path, "file:") {
		return path
	}
	query := "_busy_timeout=30000&_journal_mode=WAL&_synchronous=NORMAL"
	if strings.Contains(path, "?") {
		return "file:" + path + "&" + query
	}
	return "file:" + path + "?" + query
}

func parseMySQLURL(databaseURL string) (driver string, dsn string, dialect string, err error) {
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		return "", "", "", err
	}

	scheme := strings.ToLower(parsed.Scheme)
	if !strings.HasPrefix(scheme, "mysql") && !strings.HasPrefix(scheme, "mariadb") {
		return "", "", "", fmt.Errorf("unsupported database scheme: %s", parsed.Scheme)
	}

	username := parsed.User.Username()
	password, _ := parsed.User.Password()
	host := parsed.Host
	if host == "" {
		host = "127.0.0.1:3306"
	}
	if _, _, splitErr := net.SplitHostPort(host); splitErr != nil && !strings.Contains(host, "/") {
		host = net.JoinHostPort(host, "3306")
	}

	cfg := mysql.Config{
		User:                 username,
		Passwd:               password,
		Net:                  "tcp",
		Addr:                 host,
		DBName:               strings.TrimPrefix(parsed.Path, "/"),
		ParseTime:            true,
		Loc:                  time.UTC,
		Timeout:              10 * time.Second,
		ReadTimeout:          30 * time.Second,
		WriteTimeout:         30 * time.Second,
		AllowNativePasswords: true,
		Params: map[string]string{
			"charset":   "utf8mb4",
			"collation": "utf8mb4_unicode_ci",
		},
	}
	for key, values := range parsed.Query() {
		if len(values) == 0 {
			continue
		}
		cfg.Params[key] = values[len(values)-1]
	}
	return "mysql", cfg.FormatDSN(), "mysql", nil
}
