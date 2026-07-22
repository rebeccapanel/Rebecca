package gateway

import (
	"bufio"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	Addr             string
	ExtraListenPorts []int
	TLSCertFile      string
	TLSKeyFile       string
	DashboardPath    string
	APIHandler       http.Handler
}

func LoadConfig() Config {
	env := loadEnvFiles()
	return Config{
		Addr:          gatewayListenAddr(env),
		TLSCertFile:   lookupEnv(env, "UVICORN_SSL_CERTFILE", ""),
		TLSKeyFile:    lookupEnv(env, "UVICORN_SSL_KEYFILE", ""),
		DashboardPath: "/dashboard/",
	}
}

func gatewayListenAddr(env map[string]string) string {
	if addr := lookupEnv(env, "REBECCA_GATEWAY_ADDR", ""); addr != "" {
		return addr
	}
	host := lookupEnv(env, "UVICORN_HOST", "0.0.0.0")
	port := lookupEnv(env, "UVICORN_PORT", "8000")
	if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") {
		return net.JoinHostPort(host, port)
	}
	if host == "" || host == "0.0.0.0" {
		return ":" + port
	}
	return net.JoinHostPort(host, port)
}

func lookupEnv(env map[string]string, key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value != "" {
		return value
	}
	if value := strings.TrimSpace(env[key]); value != "" {
		return value
	}
	return fallback
}

func loadEnvFiles() map[string]string {
	result := map[string]string{}
	for _, path := range candidateEnvFiles() {
		mergeEnvFile(result, path)
	}
	return result
}

func candidateEnvFiles() []string {
	seen := map[string]bool{}
	add := func(paths []string, path string) []string {
		path = strings.TrimSpace(path)
		if path == "" {
			return paths
		}
		if abs, err := filepath.Abs(path); err == nil {
			path = abs
		}
		if seen[path] {
			return paths
		}
		seen[path] = true
		return append(paths, path)
	}

	paths := []string{}
	paths = add(paths, os.Getenv("REBECCA_ENV_FILE"))
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		paths = add(paths, filepath.Join(dir, ".env"))
		paths = add(paths, filepath.Join(filepath.Dir(dir), ".env"))
	}
	if cwd, err := os.Getwd(); err == nil {
		paths = add(paths, filepath.Join(cwd, ".env"))
		paths = add(paths, filepath.Join(filepath.Dir(cwd), ".env"))
	}
	return paths
}

func mergeEnvFile(dst map[string]string, path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(strings.TrimPrefix(key, "export "))
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if key != "" {
			if _, exists := dst[key]; !exists {
				dst[key] = value
			}
		}
	}
}
