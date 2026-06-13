package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/api"
	"github.com/rebeccapanel/rebecca/internal/gateway"
)

func main() {
	cfg := gateway.LoadConfig()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	apiCfg, err := api.LoadConfig()
	if err != nil {
		log.Fatalf("failed to load Rebecca API config: %v", err)
	}
	api, err := api.New(apiCfg)
	if err != nil {
		log.Fatalf("failed to initialize Rebecca API: %v", err)
	}
	api.StartBackground(ctx)
	cfg.APIHandler = api.Handler()

	server, err := gateway.NewServer(cfg)
	if err != nil {
		log.Fatalf("failed to initialize gateway: %v", err)
	}

	errCh := make(chan error, 1)
	go func() {
		log.Printf("rebecca server listening on %s", cfg.Addr)
		errCh <- server.Run()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("gateway shutdown failed: %v", err)
		}
	case err := <-errCh:
		if err != nil {
			log.Fatalf("gateway failed: %v", err)
		}
	}
}
