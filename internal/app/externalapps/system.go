package externalapps

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

func prepareExternalAppHost(ctx context.Context) error {
	binary := "/usr/local/bin/rebecca"
	if _, err := os.Stat(binary); err != nil {
		binary = "rebecca"
	}
	output, err := runExternalAppCommand(ctx, 15*time.Minute, binary, "prepare-external-app-hosting")
	if err != nil {
		return fmt.Errorf("prepare PHP application host: %s", limitedExternalAppCommandOutput(output, err))
	}
	return nil
}

const externalAppNodeBin = "/opt/rebecca/node/current/bin"

func prepareExternalAppNodeHost(ctx context.Context) error {
	binary := "/usr/local/bin/rebecca"
	if _, err := os.Stat(binary); err != nil {
		binary = "rebecca"
	}
	output, err := runExternalAppCommand(ctx, 15*time.Minute, binary, "prepare-external-app-node-hosting")
	if err != nil {
		return fmt.Errorf("prepare Node.js application host: %s", limitedExternalAppCommandOutput(output, err))
	}
	return nil
}

func externalAppNodePort(id string) int {
	value, _ := strconv.ParseUint(id[:4], 16, 16)
	return 20000 + int(value)%20000
}

func writeEmptyNodeApp(root string) error {
	manifest := []byte("{\n  \"private\": true,\n  \"scripts\": {\"start\": \"node server.js\"}\n}\n")
	server := []byte("const http=require('node:http');const host=process.env.HOST||'127.0.0.1';const port=Number(process.env.PORT||3000);http.createServer((_,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end('<h1>Node.js app is ready</h1>')}).listen(port,host);\n")
	if err := os.WriteFile(filepath.Join(root, "package.json"), manifest, 0o600); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(root, "server.js"), server, 0o600)
}

func installExternalAppNode(ctx context.Context, record Record) error {
	var manifest struct {
		Scripts map[string]string `json:"scripts"`
	}
	data, err := os.ReadFile(filepath.Join(record.Root, "package.json"))
	if err != nil || json.Unmarshal(data, &manifest) != nil || strings.TrimSpace(manifest.Scripts["start"]) == "" {
		return errors.New("Node.js application package.json must define a start script")
	}
	npmArgs := []string{"install", "--no-audit", "--no-fund"}
	if _, err := os.Stat(filepath.Join(record.Root, "package-lock.json")); err == nil {
		npmArgs[0] = "ci"
	}
	if err := runExternalAppNodeCommand(ctx, record, 20*time.Minute, npmArgs...); err != nil {
		return err
	}
	if strings.TrimSpace(manifest.Scripts["build"]) != "" {
		if err := runExternalAppNodeCommand(ctx, record, 20*time.Minute, "run", "build"); err != nil {
			return err
		}
	}
	if err := runExternalAppNodeCommand(ctx, record, 10*time.Minute, "prune", "--omit=dev", "--no-audit", "--no-fund"); err != nil {
		return err
	}
	if err := writeAtomicFile(record.UnitConfig, []byte(externalAppNodeUnit(record)), 0o644); err != nil {
		return err
	}
	cleanUnit := true
	defer func() {
		if cleanUnit {
			_, _ = runExternalAppCommand(context.Background(), time.Minute, "systemctl", "disable", "--now", record.Service)
			_ = os.Remove(record.UnitConfig)
			_, _ = runExternalAppCommand(context.Background(), time.Minute, "systemctl", "daemon-reload")
		}
	}()
	if _, err := runExternalAppCommand(ctx, time.Minute, "systemctl", "daemon-reload"); err != nil {
		return fmt.Errorf("reload systemd: %w", err)
	}
	if err := startExternalAppNode(ctx, record); err != nil {
		return err
	}
	cleanUnit = false
	return nil
}

func runExternalAppNodeCommand(ctx context.Context, record Record, timeout time.Duration, args ...string) error {
	commandCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	commandArgs := append([]string{"-u", record.SystemUser, "--", filepath.Join(externalAppNodeBin, "npm")}, args...)
	command := exec.CommandContext(commandCtx, "runuser", commandArgs...)
	command.Dir = record.Root
	command.Env = append(os.Environ(), "HOME="+record.Root, "PATH="+externalAppNodeBin+":"+os.Getenv("PATH"), "npm_config_cache="+filepath.Join(record.Root, ".npm"))
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("npm %s: %s", strings.Join(args, " "), limitedExternalAppCommandOutput(output, err))
	}
	return nil
}

func externalAppNodeUnit(record Record) string {
	return fmt.Sprintf(`[Unit]
Description=Rebecca external Node.js application %s
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=%s
Group=%s
WorkingDirectory=%s
EnvironmentFile=-%s/.env
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=HOSTNAME=127.0.0.1
Environment=PORT=%d
Environment=PATH=%s:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=%s/npm run start
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=%s
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
TasksMax=256

[Install]
WantedBy=multi-user.target
`, record.Domain, record.SystemUser, record.SystemUser, record.Root, record.Root, record.Port, externalAppNodeBin, externalAppNodeBin, record.Root)
}

func startExternalAppNode(ctx context.Context, record Record) error {
	if _, err := runExternalAppCommand(ctx, time.Minute, "systemctl", "enable", "--now", record.Service); err != nil {
		return fmt.Errorf("start Node.js application: %w", err)
	}
	deadline := time.Now().Add(20 * time.Second)
	address := net.JoinHostPort("127.0.0.1", strconv.Itoa(record.Port))
	for time.Now().Before(deadline) {
		connection, err := net.DialTimeout("tcp", address, 500*time.Millisecond)
		if err == nil {
			connection.Close()
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	return errors.New("Node.js application did not start on its assigned loopback port")
}

func stopExternalAppNode(ctx context.Context, record Record) error {
	if _, err := runExternalAppCommand(ctx, time.Minute, "systemctl", "disable", "--now", record.Service); err != nil {
		return fmt.Errorf("stop Node.js application: %w", err)
	}
	return nil
}

func activePHPVersion(ctx context.Context, requireMirza bool) (string, error) {
	output, err := runExternalAppCommand(ctx, time.Minute, "php", "-r", `echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;`)
	if err != nil {
		return "", fmt.Errorf("detect PHP version: %w", err)
	}
	version := strings.TrimSpace(string(output))
	parts := strings.Split(version, ".")
	if len(parts) != 2 {
		return "", errors.New("could not detect PHP version")
	}
	major, majorErr := strconv.Atoi(parts[0])
	minor, minorErr := strconv.Atoi(parts[1])
	minimumMinor := 1
	if requireMirza {
		minimumMinor = 2
	}
	if majorErr != nil || minorErr != nil || major < 8 || (major == 8 && minor < minimumMinor) {
		if requireMirza {
			return "", errors.New("MirzaBot requires PHP 8.2 or newer")
		}
		return "", errors.New("PHP application hosting requires PHP 8.1 or newer")
	}
	if _, err := os.Stat(filepath.Join("/etc/php", version, "fpm", "pool.d")); err != nil {
		return "", errors.New("PHP-FPM configuration directory is missing")
	}
	return version, nil
}

func ensureExternalAppRuntimeFree(ctx context.Context, record Record) error {
	for _, path := range []string{record.PoolConfig, record.Socket, record.UnitConfig} {
		if path == "" {
			continue
		}
		if _, err := os.Stat(path); err == nil {
			return errExternalAppExists
		} else if !os.IsNotExist(err) {
			return err
		}
	}
	if externalAppSystemUserExists(ctx, record.SystemUser) {
		return errExternalAppExists
	}
	return nil
}

func (m *Manager) ensureMirzaInstallTargetsFree(ctx context.Context, record Record) error {
	for _, path := range []string{
		record.Root,
		record.PoolConfig,
		record.CronConfig,
		m.recordPathFor(record),
		m.secretPathFor(record),
	} {
		if _, err := os.Stat(path); err == nil {
			return errExternalAppExists
		} else if !os.IsNotExist(err) {
			return err
		}
	}
	if externalAppSystemUserExists(ctx, record.SystemUser) {
		return errExternalAppExists
	}
	query := "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name=" + sqlString(record.Database) + ";\n" +
		"SELECT COUNT(*) FROM mysql.user WHERE User=" + sqlString(record.DatabaseUser) + ";\n"
	output, err := m.mysqlRoot(ctx, query)
	if err != nil {
		return fmt.Errorf("inspect local database: %w", err)
	}
	for _, value := range strings.Fields(string(output)) {
		if value != "0" {
			return errExternalAppExists
		}
	}
	return nil
}

func prepareOwnedExternalAppTree(root string, uid, gid int) error {
	if err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		return os.Chown(path, uid, gid)
	}); err != nil {
		return fmt.Errorf("set application ownership: %w", err)
	}
	if err := os.Chmod(root, 0o700); err != nil {
		return err
	}
	for _, dir := range []string{".composer", ".sessions", ".tmp", ".logs", ".locks"} {
		path := filepath.Join(root, dir)
		if err := os.MkdirAll(path, 0o700); err != nil {
			return err
		}
		if err := os.Chown(path, uid, gid); err != nil {
			return err
		}
	}
	return nil
}

func makeStaticTreeReadOnly(root string) error {
	return filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		mode := os.FileMode(0o644)
		if info.IsDir() {
			mode = 0o755
		}
		if err := os.Chmod(path, mode); err != nil {
			return err
		}
		return os.Chown(path, 0, 0)
	})
}

func writeExternalAppPool(record Record, mirza bool) error {
	return writeAtomicFile(record.PoolConfig, []byte(externalAppPoolConfig(record, mirza)), 0o600)
}

func externalAppPoolConfig(record Record, mirza bool) string {
	disabledFunctions := "exec,passthru,shell_exec,system,proc_open,popen,pcntl_exec"
	if mirza {
		// Telegram bot database backups use exec; all other process-spawning APIs stay disabled.
		disabledFunctions = "passthru,shell_exec,system,proc_open,popen,pcntl_exec"
	}
	maxChildren := 2
	if record.Template == "faoxima" {
		maxChildren = 6
	}
	return fmt.Sprintf(`[%s]
user = %s
group = %s
listen = %s
listen.owner = root
listen.group = root
listen.mode = 0600
pm = ondemand
pm.max_children = %d
pm.process_idle_timeout = 15s
pm.max_requests = 500
chdir = %s
clear_env = yes
env[PATH] = /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
catch_workers_output = yes
request_terminate_timeout = 120s
security.limit_extensions = .php
php_admin_flag[display_errors] = off
php_admin_flag[log_errors] = on
php_admin_flag[allow_url_include] = off
php_admin_flag[expose_php] = off
php_admin_value[disable_functions] = %s
php_admin_value[error_log] = %s/.logs/php-error.log
php_admin_value[open_basedir] = %s:/tmp
php_admin_value[session.save_path] = %s/.sessions
php_admin_value[upload_tmp_dir] = %s/.tmp
php_admin_value[upload_max_filesize] = 32M
php_admin_value[post_max_size] = 32M
php_admin_value[memory_limit] = 256M
`, "rebecca-"+filepath.Base(record.Root), record.SystemUser, record.SystemUser, record.Socket, maxChildren, record.Root,
		disabledFunctions, record.Root, record.Root, record.Root, record.Root)
}

func reloadPHPFPM(ctx context.Context, record Record) error {
	binary := "php-fpm" + record.PHPVersion
	if output, err := runExternalAppCommand(ctx, time.Minute, binary, "-t"); err != nil {
		return fmt.Errorf("validate PHP-FPM configuration: %s", limitedExternalAppCommandOutput(output, err))
	}
	if output, err := runExternalAppCommand(ctx, time.Minute, "systemctl", "reload", record.Service); err != nil {
		return fmt.Errorf("reload PHP-FPM: %s", limitedExternalAppCommandOutput(output, err))
	}
	return waitForExternalAppPath(ctx, record.Socket, 10*time.Second)
}

func installMirzaBotDependencies(ctx context.Context, appRoot, systemUser string) error {
	commandCtx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	command := exec.CommandContext(commandCtx, "runuser",
		"-u", systemUser, "--", "composer", "install",
		"--working-dir="+appRoot, "--no-dev", "--prefer-dist", "--optimize-autoloader",
		"--no-progress", "--no-interaction", "--no-scripts", "--no-plugins",
	)
	command.Env = append(os.Environ(), "HOME="+appRoot, "COMPOSER_HOME="+filepath.Join(appRoot, ".composer"), "COMPOSER_NO_INTERACTION=1")
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("install pinned MirzaBot dependencies: %s", limitedExternalAppCommandOutput(output, err))
	}
	if _, err := os.Stat(filepath.Join(appRoot, "vendor", "autoload.php")); err != nil {
		return errors.New("Composer completed without vendor/autoload.php")
	}
	return nil
}

func initializeMirzaBotDatabase(ctx context.Context, appRoot, systemUser string, uid, gid int) error {
	return initializeTelegramBotDatabase(ctx, appRoot, systemUser, uid, gid, mirzaBotTableInitializer)
}

func initializeTelegramBotDatabase(ctx context.Context, appRoot, systemUser string, uid, gid int, initializer func([]byte) ([]byte, error)) error {
	table, err := os.ReadFile(filepath.Join(appRoot, "table.php"))
	if err != nil {
		return err
	}
	prepared, err := initializer(table)
	if err != nil {
		return err
	}
	path := filepath.Join(appRoot, ".rebecca-init.php")
	if err := os.WriteFile(path, prepared, 0o600); err != nil {
		return err
	}
	defer os.Remove(path)
	if err := os.Chown(path, uid, gid); err != nil {
		return err
	}
	commandCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	command := exec.CommandContext(commandCtx, "runuser", "-u", systemUser, "--", "php", ".rebecca-init.php")
	command.Dir = appRoot
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("initialize MirzaBot database: %s", limitedExternalAppCommandOutput(output, err))
	}
	// Keep upstream webhook setup in the one-time initializer only; running it
	// for every Telegram update quickly triggers Telegram rate limits.
	if err := os.WriteFile(filepath.Join(appRoot, "table.php"), prepared, 0o600); err != nil {
		return fmt.Errorf("disable runtime Telegram webhook setup: %w", err)
	}
	if err := os.Chown(filepath.Join(appRoot, "table.php"), uid, gid); err != nil {
		return fmt.Errorf("set runtime Telegram table ownership: %w", err)
	}
	return nil
}

func mirzaBotTableInitializer(table []byte) ([]byte, error) {
	if matches := mirzaWebhookCallPattern.FindAllIndex(table, -1); len(matches) != 1 {
		return nil, errors.New("MirzaBot table initializer does not contain exactly one setWebhook call")
	}
	return mirzaWebhookCallPattern.ReplaceAll(table, []byte("// Webhook is configured by Rebecca with a secret token.")), nil
}

func configureFaoximaBot(config []byte, database, username, password, botToken, adminID, domain, botUsername string) ([]byte, error) {
	values := map[string]string{
		"dbname":      database,
		"usernamedb":  username,
		"passworddb":  password,
		"dbhost":      "127.0.0.1",
		"APIKEY":      botToken,
		"adminnumber": adminID,
		"domainhosts": domain,
		"usernamebot": botUsername,
	}
	updated := config
	for variable, value := range values {
		pattern := regexp.MustCompile(`(?m)(\$` + regexp.QuoteMeta(variable) + `\s*=\s*)'[^']*'(\s*;)`)
		matches := pattern.FindAllIndex(updated, -1)
		if len(matches) != 1 {
			return nil, fmt.Errorf("Faoxima config assignment %s is missing or ambiguous", variable)
		}
		updated = []byte(pattern.ReplaceAllStringFunc(string(updated), func(match string) string {
			semicolon := strings.LastIndex(match, ";")
			if semicolon < 0 {
				return match
			}
			return "$" + variable + " = '" + phpSingleQuoted(value) + "'" + match[semicolon:]
		}))
	}
	return updated, nil
}

func faoximaTableInitializer(table []byte) ([]byte, error) {
	startMarker := []byte("$hookParams = [")
	endMarker := []byte("if (!is_array($rxSetHookResp) || empty($rxSetHookResp['ok'])) {")
	start := bytes.Index(table, startMarker)
	if start < 0 || bytes.Count(table, startMarker) != 1 {
		return nil, errors.New("Faoxima table initializer changed unexpectedly")
	}
	relEnd := bytes.Index(table[start:], endMarker)
	if relEnd < 0 {
		return nil, errors.New("Faoxima webhook setup changed unexpectedly")
	}
	end := start + relEnd
	closeRel := bytes.Index(table[end:], []byte("\n}\n"))
	if closeRel < 0 {
		return nil, errors.New("Faoxima webhook setup is incomplete")
	}
	end += closeRel + len("\n}\n")
	updated := make([]byte, 0, len(table)-end+start+64)
	updated = append(updated, table[:start]...)
	updated = append(updated, []byte("// Webhook is configured by Rebecca with a secret token.\n")...)
	updated = append(updated, table[end:]...)
	return updated, nil
}

func writeExternalAppSecretFile(root, name, value string, uid, gid int) error {
	path := filepath.Join(root, name)
	if err := os.WriteFile(path, []byte(value+"\n"), 0o600); err != nil {
		return err
	}
	return os.Chown(path, uid, gid)
}

type mirzaCronTask struct {
	schedule string
	path     string
	dir      string
}

var mirzaCronTasks = []mirzaCronTask{
	{"*/15 * * * *", "statusday.php", ""},
	{"* * * * *", "croncard.php", ""},
	{"* * * * *", "NoticationsService.php", ""},
	{"*/5 * * * *", "payment_expire.php", ""},
	{"* * * * *", "sendmessage.php", ""},
	{"*/3 * * * *", "plisio.php", ""},
	{"* * * * *", "activeconfig.php", ""},
	{"* * * * *", "disableconfig.php", ""},
	{"* * * * *", "iranpay1.php", ""},
	{"0 */5 * * *", "backupbot.php", ""},
	{"*/2 * * * *", "gift.php", ""},
	{"*/30 * * * *", "expireagent.php", ""},
	{"*/15 * * * *", "on_hold.php", ""},
	{"*/2 * * * *", "configtest.php", ""},
	{"*/15 * * * *", "uptime_node.php", ""},
	{"*/15 * * * *", "uptime_panel.php", ""},
	{"* * * * *", "lottery.php", ""},
	{"*/2 * * * *", "alert_balance.php", ""},
	{"*/30 * * * *", "optimize_order.php", ""},
}

func writeMirzaCron(record Record) error {
	if info, err := os.Stat(filepath.Join(record.Root, "cronbot", "run.php")); err == nil && !info.IsDir() {
		return writeTelegramCron(record, []mirzaCronTask{{"* * * * *", "run.php", ""}})
	}
	return writeTelegramCron(record, mirzaCronTasks)
}

func writeFaoximaCron(record Record) error {
	if info, err := os.Stat(filepath.Join(record.Root, "cron", "cron.php")); err == nil && !info.IsDir() {
		return writeTelegramCron(record, []mirzaCronTask{{"* * * * *", "cron.php", "cron"}})
	}
	tasks := make([]mirzaCronTask, 0, len(mirzaCronTasks))
	for _, task := range mirzaCronTasks {
		if _, err := os.Stat(filepath.Join(record.Root, "cronbot", task.path)); err == nil {
			tasks = append(tasks, task)
		}
	}
	return writeTelegramCron(record, tasks)
}

func writeBotCron(record Record) error {
	if record.Template == "faoxima" {
		return writeFaoximaCron(record)
	}
	return writeMirzaCron(record)
}

func cronTaskDir(task mirzaCronTask) string {
	if task.dir == "" {
		return "cronbot"
	}
	return task.dir
}

func writeTelegramCron(record Record, tasks []mirzaCronTask) error {
	secretPath := filepath.Join(record.Root, ".rebecca-cron-secret")
	var content strings.Builder
	content.WriteString("SHELL=/bin/sh\nPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\nMAILTO=\"\"\n\n")
	for _, task := range tasks {
		lockPath := filepath.Join(record.Root, ".locks", strings.TrimSuffix(task.path, ".php")+".lock")
		fmt.Fprintf(&content,
			"%s %s /usr/bin/flock -n %s /usr/bin/curl -fsS --max-time 50 --resolve %s:443:127.0.0.1 -H \"X-Rebecca-Cron-Secret: $(/bin/cat %s)\" %s/%s/%s >/dev/null 2>&1\n",
			task.schedule, record.SystemUser, shellQuote(lockPath), record.Domain, shellQuote(secretPath), externalAppPublicURL(record), cronTaskDir(task), task.path,
		)
	}
	return writeAtomicFile(record.CronConfig, []byte(content.String()), 0o644)
}

func writeAtomicFile(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(path), ".rebecca-*.tmp")
	if err != nil {
		return err
	}
	name := temp.Name()
	defer os.Remove(name)
	if err := temp.Chmod(mode); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

type databaseCredentials struct {
	Username string
	Host     string
	Port     string
}

func parseDatabaseCredentials(databaseURL string) (databaseCredentials, error) {
	parsed, err := url.Parse(strings.TrimSpace(databaseURL))
	if err != nil {
		return databaseCredentials{}, err
	}
	scheme := strings.ToLower(parsed.Scheme)
	if !strings.HasPrefix(scheme, "mysql") && !strings.HasPrefix(scheme, "mariadb") {
		return databaseCredentials{}, errors.New("external application databases require MySQL or MariaDB")
	}
	username := strings.TrimSpace(parsed.User.Username())
	if username == "" {
		return databaseCredentials{}, errors.New("database username is missing")
	}
	host := strings.TrimSpace(parsed.Hostname())
	if host == "" {
		host = "127.0.0.1"
	}
	port := strings.TrimSpace(parsed.Port())
	if port == "" {
		port = "3306"
	}
	return databaseCredentials{Username: username, Host: host, Port: port}, nil
}

func (m *Manager) ensureExternalAppDatabaseFree(ctx context.Context, database, username string) error {
	query := "SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name=" + sqlString(database) + "), " +
		"EXISTS(SELECT 1 FROM mysql.user WHERE User=" + sqlString(username) + ");\n"
	output, err := m.mysqlRoot(ctx, query)
	if err != nil {
		return fmt.Errorf("check application database availability: %w", err)
	}
	values := strings.Fields(string(output))
	if len(values) != 2 || values[0] != "0" || values[1] != "0" {
		return errors.New("database name or database username already exists")
	}
	return nil
}

func (m *Manager) createExternalAppDatabase(ctx context.Context, database, username, password string) error {
	credentials, err := parseDatabaseCredentials(m.databaseURL)
	if err != nil {
		return err
	}
	hostOutput, err := m.mysqlRoot(ctx, "SELECT Host FROM mysql.user WHERE User="+sqlString(credentials.Username)+" ORDER BY Host;\n")
	if err != nil {
		return fmt.Errorf("find Rebecca database grants: %w", err)
	}
	hosts := strings.Fields(string(hostOutput))
	if len(hosts) == 0 {
		return errors.New("Rebecca database user has no local MySQL account")
	}
	var query strings.Builder
	fmt.Fprintf(&query, "CREATE DATABASE %s CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n", sqlIdentifier(database))
	for _, host := range []string{"127.0.0.1", "localhost"} {
		fmt.Fprintf(&query, "CREATE USER %s@%s IDENTIFIED BY %s;\n", sqlString(username), sqlString(host), sqlString(password))
		fmt.Fprintf(&query, "GRANT ALL PRIVILEGES ON %s.* TO %s@%s;\n", sqlIdentifier(database), sqlString(username), sqlString(host))
	}
	seen := map[string]bool{}
	for _, host := range hosts {
		if seen[host] {
			continue
		}
		seen[host] = true
		fmt.Fprintf(&query, "GRANT ALL PRIVILEGES ON %s.* TO %s@%s;\n", sqlIdentifier(database), sqlString(credentials.Username), sqlString(host))
	}
	if _, err := m.mysqlRoot(ctx, query.String()); err != nil {
		return fmt.Errorf("create isolated application database: %w", err)
	}
	return nil
}

func (m *Manager) verifyExternalAppDatabase(ctx context.Context, database string) error {
	output, err := m.mysqlRoot(ctx, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema="+sqlString(database)+";\n")
	if err != nil {
		return fmt.Errorf("verify MirzaBot database: %w", err)
	}
	count, err := strconv.Atoi(strings.TrimSpace(string(output)))
	if err != nil || count < 10 {
		return errors.New("MirzaBot database initialization did not create the expected tables")
	}
	return nil
}

func (m *Manager) setExternalAppWebhookSecret(ctx context.Context, database, secret string) error {
	probe, err := m.mysqlRoot(ctx, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema="+sqlString(database)+" AND table_name='config';\n")
	if err != nil {
		return fmt.Errorf("store MirzaBot webhook secret: %w", err)
	}
	query := "UPDATE " + sqlIdentifier(database) + ".setting SET webhook_secret=" + sqlString(secret) + ";\n"
	if strings.TrimSpace(string(probe)) != "0" {
		query = "INSERT INTO " + sqlIdentifier(database) + ".config (scope,name,value) VALUES ('setting','webhook_secret'," + sqlString(secret) + ") ON DUPLICATE KEY UPDATE value=VALUES(value);\n"
	}
	if _, err := m.mysqlRoot(ctx, query); err != nil {
		return fmt.Errorf("store MirzaBot webhook secret: %w", err)
	}
	return nil
}

func (m *Manager) importExternalAppDatabase(ctx context.Context, database, username, password string, data []byte) error {
	if len(data) == 0 || len(data) > maxExternalAppArchiveBytes {
		return errors.New("SQL backup is empty or exceeds 32 MiB")
	}
	file, err := os.CreateTemp("", "rebecca-mysql-app-*.cnf")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	if err := file.Chmod(0o600); err != nil {
		file.Close()
		return err
	}
	_, writeErr := fmt.Fprintf(file, "[client]\nuser=%s\npassword=%s\nhost=127.0.0.1\nport=3306\n", mysqlOptionFileValue(username), mysqlOptionFileValue(password))
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		return errors.New("write temporary database credentials")
	}
	binary := "mysql"
	if _, err := exec.LookPath(binary); err != nil {
		binary = "mariadb"
		if _, err := exec.LookPath(binary); err != nil {
			return errors.New("MySQL or MariaDB client is not installed")
		}
	}
	commandCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	command := exec.CommandContext(commandCtx, binary, "--defaults-extra-file="+name, "--protocol=tcp", "--database="+database)
	command.Stdin = bytes.NewReader(data)
	if output, err := command.CombinedOutput(); err != nil {
		return fmt.Errorf("import MirzaBot database backup: %s", limitedExternalAppCommandOutput(output, err))
	}
	return nil
}

func (m *Manager) dumpExternalAppDatabase(parent context.Context, database string) (*os.File, error) {
	if !databaseNamePattern.MatchString(database) {
		return nil, errors.New("application database is invalid")
	}
	binary := "mariadb-dump"
	if _, err := exec.LookPath(binary); err != nil {
		binary = "mysqldump"
		if _, err := exec.LookPath(binary); err != nil {
			return nil, errors.New("mariadb-dump or mysqldump is not installed")
		}
	}
	dump, err := os.CreateTemp("", "rebecca-external-app-*.sql")
	if err != nil {
		return nil, err
	}
	cleanup := func(err error) (*os.File, error) {
		name := dump.Name()
		_ = dump.Close()
		_ = os.Remove(name)
		return nil, err
	}
	var stderr bytes.Buffer
	run := func(extraFile string, connection ...string) error {
		if err := dump.Truncate(0); err != nil {
			return err
		}
		if _, err := dump.Seek(0, io.SeekStart); err != nil {
			return err
		}
		stderr.Reset()
		args := append([]string(nil), connection...)
		args = append(args, "--user=root", "--single-transaction", "--quick", "--skip-lock-tables", "--routines", "--events", "--triggers", "--hex-blob", "--default-character-set=utf8mb4", database)
		if extraFile != "" {
			args = append([]string{"--defaults-extra-file=" + extraFile}, args...)
		}
		ctx, cancel := context.WithTimeout(parent, 10*time.Minute)
		defer cancel()
		command := exec.CommandContext(ctx, binary, args...)
		command.Stdout = dump
		command.Stderr = &stderr
		return command.Run()
	}
	if err := run("", "--protocol=socket"); err != nil {
		password := strings.TrimSpace(m.rootPassword)
		if password == "" {
			return cleanup(fmt.Errorf("export application database: %s", limitedExternalAppCommandOutput(stderr.Bytes(), err)))
		}
		credentialsFile, fileErr := os.CreateTemp("", "rebecca-mysql-root-*.cnf")
		if fileErr != nil {
			return cleanup(fileErr)
		}
		credentialsPath := credentialsFile.Name()
		defer os.Remove(credentialsPath)
		if fileErr = credentialsFile.Chmod(0o600); fileErr == nil {
			_, fileErr = fmt.Fprintf(credentialsFile, "[client]\nuser=root\npassword=%s\n", mysqlOptionFileValue(password))
		}
		if closeErr := credentialsFile.Close(); fileErr == nil {
			fileErr = closeErr
		}
		if fileErr != nil {
			return cleanup(errors.New("write temporary database credentials"))
		}
		if err = run(credentialsPath, "--protocol=socket"); err != nil {
			credentials, parseErr := parseDatabaseCredentials(m.databaseURL)
			if parseErr != nil {
				return cleanup(fmt.Errorf("export application database: %s", limitedExternalAppCommandOutput(stderr.Bytes(), err)))
			}
			if err = run(credentialsPath, "--protocol=tcp", "--host="+credentials.Host, "--port="+credentials.Port); err != nil {
				return cleanup(fmt.Errorf("export application database: %s", limitedExternalAppCommandOutput(stderr.Bytes(), err)))
			}
		}
	}
	if err := dump.Sync(); err != nil {
		return cleanup(err)
	}
	if _, err := dump.Seek(0, io.SeekStart); err != nil {
		return cleanup(err)
	}
	return dump, nil
}

func (m *Manager) dropExternalAppDatabase(ctx context.Context, database, username string) error {
	query := fmt.Sprintf("DROP DATABASE IF EXISTS %s;\nDROP USER IF EXISTS %s@'127.0.0.1';\nDROP USER IF EXISTS %s@'localhost';\n",
		sqlIdentifier(database), sqlString(username), sqlString(username))
	_, err := m.mysqlRoot(ctx, query)
	return err
}

func (m *Manager) mysqlRoot(parent context.Context, query string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(parent, time.Minute)
	defer cancel()
	binary := "mysql"
	if _, err := exec.LookPath(binary); err != nil {
		binary = "mariadb"
		if _, err := exec.LookPath(binary); err != nil {
			return nil, errors.New("MySQL or MariaDB client is not installed")
		}
	}
	baseArgs := []string{"-uroot", "--batch", "--skip-column-names"}
	run := func(extraFile string, connection ...string) ([]byte, error) {
		args := append(append([]string(nil), connection...), baseArgs...)
		if extraFile != "" {
			args = append([]string{"--defaults-extra-file=" + extraFile}, args...)
		}
		command := exec.CommandContext(ctx, binary, args...)
		command.Stdin = strings.NewReader(query)
		return command.CombinedOutput()
	}
	if output, err := run("", "--protocol=socket"); err == nil {
		return output, nil
	}
	password := strings.TrimSpace(m.rootPassword)
	if password == "" {
		return nil, errors.New("local root socket authentication failed")
	}
	file, err := os.CreateTemp("", "rebecca-mysql-root-*.cnf")
	if err != nil {
		return nil, err
	}
	name := file.Name()
	defer os.Remove(name)
	if err := file.Chmod(0o600); err != nil {
		file.Close()
		return nil, err
	}
	_, writeErr := fmt.Fprintf(file, "[client]\nuser=root\npassword=%s\n", mysqlOptionFileValue(password))
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		return nil, errors.New("write temporary database credentials")
	}
	if output, err := run(name, "--protocol=socket"); err == nil {
		return output, nil
	}
	credentials, err := parseDatabaseCredentials(m.databaseURL)
	if err == nil {
		if output, tcpErr := run(name, "--protocol=tcp", "--host="+credentials.Host, "--port="+credentials.Port); tcpErr == nil {
			return output, nil
		}
	}
	return nil, errors.New("local root database authentication failed")
}

func mysqlOptionFileValue(value string) string {
	value = strings.NewReplacer("\\", "\\\\", "\"", "\\\"", "\n", "\\n", "\r", "\\r").Replace(value)
	return "\"" + value + "\""
}

type mirzaBotSource struct {
	Version string
	SHA     string
	Archive []byte
}

type mirzaBotRelease struct {
	Version string
	SHA     string
}

func (m *Manager) latestMirzaBotRelease(ctx context.Context) (mirzaBotRelease, error) {
	apiBase := strings.TrimSuffix(m.mirzaAPIBase, "/")
	if apiBase == "" {
		apiBase = mirzaBotAPIBaseURL
	}
	var tags []struct {
		Name   string `json:"name"`
		Commit struct {
			SHA string `json:"sha"`
		} `json:"commit"`
	}
	if err := m.getMirzaBotJSON(ctx, apiBase+"/tags?per_page=100", &tags); err != nil {
		return mirzaBotRelease{}, fmt.Errorf("find latest MirzaBot version: %w", err)
	}
	var latest mirzaBotRelease
	for _, tag := range tags {
		version := strings.TrimSpace(tag.Name)
		sha := strings.ToLower(strings.TrimSpace(tag.Commit.SHA))
		if !mirzaReleasePattern.MatchString(version) || !mirzaCommitPattern.MatchString(sha) {
			continue
		}
		comparison, ok := compareMirzaBotVersions(latest.Version, version)
		if latest.Version == "" || ok && comparison < 0 {
			latest = mirzaBotRelease{Version: version, SHA: sha}
		}
	}
	if latest.Version == "" {
		return mirzaBotRelease{}, errors.New("GitHub did not return a valid MirzaBot version")
	}
	return latest, nil
}

func (m *Manager) cachedMirzaBotRelease(ctx context.Context) (mirzaBotRelease, error) {
	m.releaseMu.Lock()
	defer m.releaseMu.Unlock()
	if m.release.SHA != "" && time.Now().Before(m.releaseUntil) {
		return m.release, nil
	}
	release, err := m.latestMirzaBotRelease(ctx)
	if err != nil {
		if m.release.SHA != "" {
			return m.release, nil
		}
		return mirzaBotRelease{}, err
	}
	m.release = release
	m.releaseUntil = time.Now().Add(10 * time.Minute)
	return release, nil
}

func (m *Manager) downloadMirzaBot(ctx context.Context) (mirzaBotSource, error) {
	release, err := m.latestMirzaBotRelease(ctx)
	if err != nil {
		return mirzaBotSource{}, err
	}
	archiveBase := strings.TrimSuffix(m.mirzaArchive, "/")
	if archiveBase == "" {
		archiveBase = mirzaBotArchiveBaseURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, archiveBase+"/zip/"+release.SHA, nil)
	if err != nil {
		return mirzaBotSource{}, err
	}
	setMirzaBotGitHubHeaders(req)
	response, err := m.doExternalAppRequest(req)
	if err != nil {
		return mirzaBotSource{}, errors.New("download latest stable MirzaBot source failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return mirzaBotSource{}, fmt.Errorf("download latest stable MirzaBot source returned HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxExternalAppArchiveBytes+1))
	if err != nil {
		return mirzaBotSource{}, fmt.Errorf("read MirzaBot archive: %w", err)
	}
	if len(data) == 0 || len(data) > maxExternalAppArchiveBytes {
		return mirzaBotSource{}, errors.New("MirzaBot archive is empty or exceeds 32 MiB")
	}
	return mirzaBotSource{Version: release.Version, SHA: release.SHA, Archive: data}, nil
}

func (m *Manager) downloadFaoxima(ctx context.Context) (mirzaBotSource, error) {
	archiveBase := strings.TrimSuffix(m.faoximaArchive, "/")
	if archiveBase == "" {
		archiveBase = faoximaArchiveBaseURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, archiveBase+"/zip/refs/heads/main", nil)
	if err != nil {
		return mirzaBotSource{}, err
	}
	setMirzaBotGitHubHeaders(req)
	response, err := m.doExternalAppRequest(req)
	if err != nil {
		return mirzaBotSource{}, errors.New("download latest stable Faoxima source failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return mirzaBotSource{}, fmt.Errorf("download latest stable Faoxima source returned HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxExternalAppArchiveBytes+1))
	if err != nil {
		return mirzaBotSource{}, fmt.Errorf("read Faoxima archive: %w", err)
	}
	if len(data) == 0 || len(data) > maxExternalAppArchiveBytes {
		return mirzaBotSource{}, errors.New("Faoxima archive is empty or exceeds 32 MiB")
	}
	return mirzaBotSource{Version: "main", SHA: sha256Hex(data), Archive: data}, nil
}

func (m *Manager) getMirzaBotJSON(ctx context.Context, endpoint string, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	setMirzaBotGitHubHeaders(req)
	response, err := m.doExternalAppRequest(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("GitHub returned HTTP %d", response.StatusCode)
	}
	reader := io.LimitReader(response.Body, 1<<20)
	if err := json.NewDecoder(reader).Decode(target); err != nil {
		return errors.New("GitHub returned an invalid response")
	}
	return nil
}

func (m *Manager) doExternalAppRequest(request *http.Request) (*http.Response, error) {
	if m.httpClient != nil {
		return m.httpClient.Do(request)
	}
	return http.DefaultClient.Do(request)
}

func setMirzaBotGitHubHeaders(request *http.Request) {
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "Rebecca")
}

func (m *Manager) telegramBotUsername(ctx context.Context, token string) (string, error) {
	var response struct {
		OK     bool `json:"ok"`
		Result struct {
			Username string `json:"username"`
		} `json:"result"`
	}
	if err := m.telegramRequest(ctx, token, "getMe", nil, &response); err != nil {
		return "", err
	}
	username := strings.TrimPrefix(strings.TrimSpace(response.Result.Username), "@")
	if !response.OK || username == "" {
		return "", errors.New("Telegram did not accept this bot token")
	}
	return username, nil
}

func (m *Manager) setTelegramWebhook(ctx context.Context, token string, record Record, secret string) error {
	payload := url.Values{
		"url":                  {telegramWebhookURL(record, secret)},
		"secret_token":         {secret},
		"drop_pending_updates": {"false"},
	}
	var response struct {
		OK bool `json:"ok"`
	}
	if err := m.telegramRequest(ctx, token, "setWebhook", payload, &response); err != nil {
		return err
	}
	if !response.OK {
		return errors.New("Telegram rejected the webhook")
	}
	return nil
}

func faoximaWebhookSecret(botToken string) string {
	sum := sha256.Sum256([]byte(botToken + "_faoxima_webhook_secret"))
	return hex.EncodeToString(sum[:])
}

func telegramWebhookURL(record Record, secret string) string {
	webhookURL := externalAppWebhookURL(record)
	if record.Template == "mirzabot" {
		webhookURL += "?secret=" + url.QueryEscape(secret)
	}
	return webhookURL
}

func externalAppWebhookURL(record Record) string {
	return externalAppPublicURL(record) + "/index.php"
}

func removeMirzaBotInstaller(root string) error {
	for _, name := range []string{"install.sh", "install", "installer"} {
		if err := os.RemoveAll(filepath.Join(root, name)); err != nil {
			return fmt.Errorf("remove MirzaBot installer: %w", err)
		}
	}
	return nil
}

func (m *Manager) deleteTelegramWebhook(ctx context.Context, token string) error {
	var response struct {
		OK bool `json:"ok"`
	}
	if err := m.telegramRequest(ctx, token, "deleteWebhook", url.Values{"drop_pending_updates": {"false"}}, &response); err != nil {
		return err
	}
	if !response.OK {
		return errors.New("Telegram rejected the webhook removal")
	}
	return nil
}

func (m *Manager) telegramRequest(ctx context.Context, token, method string, payload url.Values, target any) error {
	endpoint := "https://api.telegram.org/bot" + token + "/" + method
	body := ""
	if payload != nil {
		body = payload.Encode()
	}
	for attempt := 0; attempt < 3; attempt++ {
		var requestBody io.Reader
		if body != "" {
			requestBody = strings.NewReader(body)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, requestBody)
		if err != nil {
			return errors.New("prepare Telegram request")
		}
		if body != "" {
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		}
		response, err := m.httpClient.Do(req)
		if err != nil {
			return errors.New("Telegram API request failed")
		}
		if response.StatusCode == http.StatusTooManyRequests && attempt < 2 {
			wait := time.Second
			if seconds, err := strconv.Atoi(strings.TrimSpace(response.Header.Get("Retry-After"))); err == nil && seconds > 0 && seconds < 30 {
				wait = time.Duration(seconds) * time.Second
			}
			response.Body.Close()
			timer := time.NewTimer(wait)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
			continue
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return fmt.Errorf("Telegram API returned HTTP %d", response.StatusCode)
		}
		if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(target); err != nil {
			return errors.New("Telegram API returned an invalid response")
		}
		return nil
	}
	return errors.New("Telegram API request rate limited")
}

func mirzaBotConfig(database, username, password, botToken, adminID, domain, botUsername string) string {
	return "<?php\n" +
		"$request_exec_timeout = null;\n" +
		"$dbhost = '127.0.0.1';\n" +
		"$dbname = '" + phpSingleQuoted(database) + "';\n" +
		"$usernamedb = '" + phpSingleQuoted(username) + "';\n" +
		"$passworddb = '" + phpSingleQuoted(password) + "';\n" +
		"$options = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false, PDO::MYSQL_ATTR_INIT_COMMAND => \"SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci\"];\n" +
		"$dsn = \"mysql:host=$dbhost;dbname=$dbname;charset=utf8mb4\";\n" +
		"try { $pdo = new PDO($dsn, $usernamedb, $passworddb, $options); } catch (\\PDOException $e) { error_log('Database connection failed'); die('error: database connection failed'); }\n" +
		"$APIKEY = '" + phpSingleQuoted(botToken) + "';\n" +
		"$adminnumber = '" + phpSingleQuoted(adminID) + "';\n" +
		"$domainhosts = '" + phpSingleQuoted(domain) + "';\n" +
		"$usernamebot = '" + phpSingleQuoted(botUsername) + "';\n" +
		"?>\n"
}

func externalAppHostPath(record Record) string {
	if record.Path == "" {
		return record.Domain
	}
	return record.Domain + "/" + record.Path
}

func phpSingleQuoted(value string) string {
	return strings.NewReplacer("\\", "\\\\", "'", "\\'", "\r", "", "\n", "").Replace(value)
}

func sqlIdentifier(value string) string {
	return "`" + strings.ReplaceAll(value, "`", "``") + "`"
}

func sqlString(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func runExternalAppCommand(parent context.Context, timeout time.Duration, name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	output, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	if ctx.Err() != nil {
		return output, ctx.Err()
	}
	return output, err
}

func limitedExternalAppCommandOutput(output []byte, err error) string {
	message := strings.TrimSpace(string(output))
	if len(message) > 2000 {
		message = message[len(message)-2000:]
	}
	if message == "" {
		return err.Error()
	}
	return message
}

func unixUserIDs(ctx context.Context, username string) (int, int, error) {
	uidOutput, err := runExternalAppCommand(ctx, time.Minute, "id", "-u", username)
	if err != nil {
		return 0, 0, err
	}
	gidOutput, err := runExternalAppCommand(ctx, time.Minute, "id", "-g", username)
	if err != nil {
		return 0, 0, err
	}
	uid, uidErr := strconv.Atoi(strings.TrimSpace(string(uidOutput)))
	gid, gidErr := strconv.Atoi(strings.TrimSpace(string(gidOutput)))
	if uidErr != nil || gidErr != nil {
		return 0, 0, errors.New("parse isolated PHP user IDs")
	}
	return uid, gid, nil
}

func externalAppSystemUserExists(ctx context.Context, username string) bool {
	if username == "" {
		return false
	}
	commandCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return exec.CommandContext(commandCtx, "id", "-u", username).Run() == nil
}

func waitForExternalAppPath(ctx context.Context, path string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(path); err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
	return errors.New("PHP-FPM socket was not created")
}
