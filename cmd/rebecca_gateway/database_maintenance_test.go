package main

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestRunManagedDatabaseMaintenance(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell helper is not available on Windows")
	}

	t.Setenv("REBECCA_INSTALL_MODE", "binary")
	dir := t.TempDir()
	argsFile := filepath.Join(dir, "args")
	script := filepath.Join(dir, "rebecca")
	contents := "#!/bin/sh\nprintf '%s' \"$*\" > \"" + argsFile + "\"\n"
	if err := os.WriteFile(script, []byte(contents), 0o755); err != nil {
		t.Fatal(err)
	}

	previousPath := rebeccaScriptPath
	rebeccaScriptPath = script
	t.Cleanup(func() { rebeccaScriptPath = previousPath })

	runManagedDatabaseMaintenance(context.Background())
	got, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(got)) != "database-maintenance" {
		t.Fatalf("unexpected arguments: %q", got)
	}
}

func TestRunManagedDatabaseMaintenanceSkipsDocker(t *testing.T) {
	t.Setenv("REBECCA_INSTALL_MODE", "docker")
	previousPath := rebeccaScriptPath
	rebeccaScriptPath = filepath.Join(t.TempDir(), "missing")
	t.Cleanup(func() { rebeccaScriptPath = previousPath })

	runManagedDatabaseMaintenance(context.Background())
}
