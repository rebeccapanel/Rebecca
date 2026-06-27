package api

import "testing"

func TestLoadConfigPrefersSQLAlchemyDatabaseURL(t *testing.T) {
	t.Setenv("SQLALCHEMY_DATABASE_URL", "sqlite:///legacy.db")
	t.Setenv("DATABASE_URL", "sqlite:///new.db")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Database != "sqlite:///legacy.db" {
		t.Fatalf("Database=%q want %q", cfg.Database, "sqlite:///legacy.db")
	}
}

func TestLoadConfigFallsBackToDatabaseURL(t *testing.T) {
	t.Setenv("SQLALCHEMY_DATABASE_URL", "")
	t.Setenv("DATABASE_URL", "sqlite:///fallback.db")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Database != "sqlite:///fallback.db" {
		t.Fatalf("Database=%q want %q", cfg.Database, "sqlite:///fallback.db")
	}
}

func TestLoadConfigReadsUsageHistoryDisableFlags(t *testing.T) {
	t.Setenv("SQLALCHEMY_DATABASE_URL", "sqlite:///usage-flags.db")
	t.Setenv("REBECCA_DISABLE_NODE_USAGE", "true")
	t.Setenv("REBECCA_DISABLE_NODE_USER_USAGES", "1")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.DisableNodeUsageHistory {
		t.Fatal("DisableNodeUsageHistory=false want true")
	}
	if !cfg.DisableNodeUserUsageHistory {
		t.Fatal("DisableNodeUserUsageHistory=false want true")
	}
}
