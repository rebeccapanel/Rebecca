package externalapps

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
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
	for _, path := range []string{record.PoolConfig, record.Socket} {
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
		m.recordPath(domainHash(record.Domain)),
		m.secretPath(domainHash(record.Domain)),
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
		// MirzaBot's database backup uses exec; all other process-spawning APIs stay disabled.
		disabledFunctions = "passthru,shell_exec,system,proc_open,popen,pcntl_exec"
	}
	return fmt.Sprintf(`[%s]
user = %s
group = %s
listen = %s
listen.owner = root
listen.group = root
listen.mode = 0600
pm = ondemand
pm.max_children = 2
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
`, "rebecca-"+filepath.Base(record.Root), record.SystemUser, record.SystemUser, record.Socket, record.Root,
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
	table, err := os.ReadFile(filepath.Join(appRoot, "table.php"))
	if err != nil {
		return err
	}
	needle := []byte("telegram('setwebhook', [\n    'url' => \"https://$domainhosts/index.php\"\n]);")
	if bytes.Count(table, needle) != 1 {
		return errors.New("pinned MirzaBot table initializer changed unexpectedly")
	}
	initializer := bytes.Replace(table, needle, []byte("// Webhook is configured by Rebecca with a secret token."), 1)
	path := filepath.Join(appRoot, ".rebecca-init.php")
	if err := os.WriteFile(path, initializer, 0o600); err != nil {
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
	return nil
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
}

var mirzaCronTasks = []mirzaCronTask{
	{"*/15 * * * *", "statusday.php"},
	{"* * * * *", "croncard.php"},
	{"* * * * *", "NoticationsService.php"},
	{"*/5 * * * *", "payment_expire.php"},
	{"* * * * *", "sendmessage.php"},
	{"*/3 * * * *", "plisio.php"},
	{"* * * * *", "activeconfig.php"},
	{"* * * * *", "disableconfig.php"},
	{"* * * * *", "iranpay1.php"},
	{"0 */5 * * *", "backupbot.php"},
	{"*/2 * * * *", "gift.php"},
	{"*/30 * * * *", "expireagent.php"},
	{"*/15 * * * *", "on_hold.php"},
	{"*/2 * * * *", "configtest.php"},
	{"*/15 * * * *", "uptime_node.php"},
	{"*/15 * * * *", "uptime_panel.php"},
	{"* * * * *", "lottery.php"},
}

func writeMirzaCron(record Record) error {
	secretPath := filepath.Join(record.Root, ".rebecca-cron-secret")
	var content strings.Builder
	content.WriteString("SHELL=/bin/sh\nPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\nMAILTO=\"\"\n\n")
	for _, task := range mirzaCronTasks {
		lockPath := filepath.Join(record.Root, ".locks", strings.TrimSuffix(task.path, ".php")+".lock")
		fmt.Fprintf(&content,
			"%s %s /usr/bin/flock -n %s /usr/bin/curl -fsS --max-time 50 --resolve %s:443:127.0.0.1 -H \"X-Rebecca-Cron-Secret: $(/bin/cat %s)\" https://%s/cronbot/%s >/dev/null 2>&1\n",
			task.schedule, record.SystemUser, shellQuote(lockPath), record.Domain, shellQuote(secretPath), record.Domain, task.path,
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
		return fmt.Errorf("create isolated MirzaBot database: %w", err)
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

func (m *Manager) downloadMirzaBot(ctx context.Context) (mirzaBotSource, error) {
	apiBase := strings.TrimSuffix(m.mirzaAPIBase, "/")
	if apiBase == "" {
		apiBase = mirzaBotAPIBaseURL
	}
	archiveBase := strings.TrimSuffix(m.mirzaArchive, "/")
	if archiveBase == "" {
		archiveBase = mirzaBotArchiveBaseURL
	}
	var release struct {
		TagName    string `json:"tag_name"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
	}
	if err := m.getMirzaBotJSON(ctx, apiBase+"/releases/latest", &release); err != nil {
		return mirzaBotSource{}, fmt.Errorf("find latest stable MirzaBot release: %w", err)
	}
	release.TagName = strings.TrimSpace(release.TagName)
	if release.Draft || release.Prerelease || !mirzaReleasePattern.MatchString(release.TagName) {
		return mirzaBotSource{}, errors.New("GitHub did not return a valid stable MirzaBot release")
	}
	var commit struct {
		SHA string `json:"sha"`
	}
	if err := m.getMirzaBotJSON(ctx, apiBase+"/commits/"+url.PathEscape(release.TagName), &commit); err != nil {
		return mirzaBotSource{}, fmt.Errorf("resolve MirzaBot release commit: %w", err)
	}
	commit.SHA = strings.ToLower(strings.TrimSpace(commit.SHA))
	if !mirzaCommitPattern.MatchString(commit.SHA) {
		return mirzaBotSource{}, errors.New("GitHub returned an invalid MirzaBot release commit")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, archiveBase+"/zip/"+commit.SHA, nil)
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
	return mirzaBotSource{Version: release.TagName, SHA: commit.SHA, Archive: data}, nil
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

func (m *Manager) setTelegramWebhook(ctx context.Context, token, domain, secret string) error {
	payload := url.Values{
		"url":                  {"https://" + domain + "/index.php"},
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
	var body io.Reader
	if payload != nil {
		body = strings.NewReader(payload.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return errors.New("prepare Telegram request")
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	response, err := m.httpClient.Do(req)
	if err != nil {
		return errors.New("Telegram API request failed")
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
