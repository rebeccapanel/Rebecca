package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/api"
	"github.com/rebeccapanel/rebecca/internal/app/logging"
	"github.com/rebeccapanel/rebecca/internal/gateway"
)

func main() {
	cfg := gateway.LoadConfig()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	apiCfg, err := api.LoadConfig()
	if err != nil {
		logging.Fatalf(logging.ComponentRuntime, "failed to load Rebecca API config: %v", err)
	}
	api, err := api.New(apiCfg)
	if err != nil {
		logging.Fatalf(logging.ComponentRuntime, "failed to initialize Rebecca API: %v", err)
	}
	if runtimeSettings, err := api.RuntimeSettings(ctx); err == nil {
		cfg.DashboardPath = runtimeSettings.DashboardPath
	} else {
		logging.Warnf(logging.ComponentRuntime, "failed to load dashboard path from settings: %v", err)
	}
	if subscriptionSettings, err := api.SubscriptionSettings(ctx); err == nil {
		cfg.ExtraListenPorts = subscriptionSettings.SubscriptionPorts
	} else {
		logging.Warnf(logging.ComponentRuntime, "failed to load subscription ports from settings: %v", err)
	}
	api.StartBackground(ctx)
	cfg.APIHandler = api.Handler()

	server, err := gateway.NewServer(cfg)
	if err != nil {
		logging.Fatalf(logging.ComponentRuntime, "failed to initialize gateway: %v", err)
	}

	errCh := make(chan error, 1)
	go func() {
		scheme := "http"
		if cfg.TLSCertFile != "" && cfg.TLSKeyFile != "" {
			scheme = "https"
		}
		logging.Infof(logging.ComponentRuntime, "server listening on %s://%s extra_ports=%v", scheme, cfg.Addr, cfg.ExtraListenPorts)
		errCh <- server.Run()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			logging.Warnf(logging.ComponentRuntime, "gateway shutdown failed: %v", err)
		}
	case err := <-errCh:
		if err != nil {
			logging.Fatalf(logging.ComponentRuntime, "gateway failed: %v", err)
		}
	}
}
