package externalapps

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func upstreamRoot(t *testing.T, name string) string {
	t.Helper()
	base := os.Getenv("REBECCA_BOT_SOURCES")
	if base == "" {
		t.Skip("set REBECCA_BOT_SOURCES to a folder holding the extracted upstream sources")
	}
	matches, _ := filepath.Glob(filepath.Join(base, name, "*"))
	if len(matches) != 1 {
		t.Skipf("no extracted %s source in %s", name, base)
	}
	return matches[0]
}

func TestUpstreamMirzaBotMatchesTheInstaller(t *testing.T) {
	root := upstreamRoot(t, "mirza")
	for _, required := range []string{"composer.json", "composer.lock", "table.php", "config.php", "index.php"} {
		if _, err := os.Stat(filepath.Join(root, required)); err != nil {
			t.Fatalf("upstream MirzaBot no longer ships %s", required)
		}
	}
	table, err := os.ReadFile(filepath.Join(root, "table.php"))
	if err != nil {
		t.Fatal(err)
	}
	prepared, err := mirzaBotTableInitializer(table)
	if err != nil {
		t.Fatalf("webhook call in table.php: %v", err)
	}
	if strings.Contains(strings.ToLower(string(prepared)), "telegram('setwebhook'") {
		t.Fatal("the upstream setWebhook call must be removed from table.php")
	}
	upstreamConfig, _ := os.ReadFile(filepath.Join(root, "config.php"))
	generated := mirzaBotConfig("db", "user", "pw", "123456:abcdefghijklmnopqrstuvwxyz", "1234567", "example.com/botabc", "mybot")
	for _, variable := range regexp.MustCompile(`(?m)^\$([A-Za-z_]+)\s*=`).FindAllStringSubmatch(string(upstreamConfig), -1) {
		if !strings.Contains(generated, "$"+variable[1]+" =") {
			t.Errorf("upstream config.php defines $%s but the generated config does not", variable[1])
		}
	}
	jobs, _ := os.ReadFile(filepath.Join(root, "cronbot", "jobs.php"))
	known := map[string]bool{}
	for _, task := range mirzaCronTasks {
		known[strings.TrimSuffix(task.path, ".php")] = true
	}
	for _, job := range regexp.MustCompile(`'job' => '([A-Za-z0-9_]+)'`).FindAllStringSubmatch(string(jobs), -1) {
		if !known[job[1]] {
			t.Errorf("upstream cron job %s is not scheduled by Rebecca", job[1])
		}
	}
	for _, task := range mirzaCronTasks {
		if _, err := os.Stat(filepath.Join(root, "cronbot", task.path)); err != nil {
			t.Errorf("Rebecca schedules cronbot/%s but upstream no longer has it", task.path)
		}
	}
}

func TestUpstreamFaoximaMatchesTheInstaller(t *testing.T) {
	root := upstreamRoot(t, "faox")
	for _, required := range []string{"composer.json", "table.php", "config.php", "index.php"} {
		if _, err := os.Stat(filepath.Join(root, required)); err != nil {
			t.Fatalf("upstream Faoxima no longer ships %s", required)
		}
	}
	config, _ := os.ReadFile(filepath.Join(root, "config.php"))
	if _, err := configureFaoximaBot(config, "db", "user", "pw", "123456:abcdefghijklmnopqrstuvwxyz", "1234567", "example.com/botabc", "mybot"); err != nil {
		t.Fatalf("config.php: %v", err)
	}
	table, _ := os.ReadFile(filepath.Join(root, "table.php"))
	if _, err := faoximaTableInitializer(table); err != nil {
		t.Fatalf("table.php: %v", err)
	}
}

func TestFaoximaWebhookSecretMatchesUpstreamDerivation(t *testing.T) {
	got := faoximaWebhookSecret("123456:abc")
	sum := sha256.Sum256([]byte("123456:abc_faoxima_webhook_secret"))
	if got != hex.EncodeToString(sum[:]) {
		t.Fatalf("secret %s does not follow the upstream derivation", got)
	}
}

func TestMirzaCronTasksCoverTheUpstreamJobs(t *testing.T) {
	seen := map[string]bool{}
	for _, task := range mirzaCronTasks {
		seen[task.path] = true
	}
	for _, job := range []string{"alert_balance.php", "optimize_order.php"} {
		if !seen[job] {
			t.Fatalf("cron list misses %s", job)
		}
	}
}
