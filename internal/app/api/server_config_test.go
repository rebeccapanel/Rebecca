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

func TestLoadConfigUsesRecordingDefaultsFromDatabaseSettings(t *testing.T) {
	t.Setenv("SQLALCHEMY_DATABASE_URL", "sqlite:///usage-flags.db")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.RecordNodeUsage {
		t.Fatal("RecordNodeUsage=false want true")
	}
	if !cfg.RecordNodeUserUsages {
		t.Fatal("RecordNodeUserUsages=false want true")
	}
}
