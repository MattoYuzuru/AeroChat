package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
	"github.com/MattoYuzuru/AeroChat/services/aero-gateway/internal/app"
	"github.com/MattoYuzuru/AeroChat/services/aero-gateway/internal/downstream"
	"github.com/MattoYuzuru/AeroChat/services/aero-gateway/internal/realtime"
)

const (
	serviceName       = "aero-gateway"
	defaultHTTPServer = ":8080"
)

var version = "dev"

func main() {
	if err := run(); err != nil {
		slog.Error("сервис завершился с ошибкой", slog.String("error", err.Error()))
		os.Exit(1)
	}
}

func run() error {
	cfg, err := app.LoadConfig(defaultHTTPServer)
	if err != nil {
		return err
	}

	logger, err := observability.NewLogger(serviceName, cfg.LogLevel)
	if err != nil {
		return err
	}

	downstreamClient := downstream.NewHTTPClient(cfg.DownstreamTimeout)
	clients := downstream.NewClients(downstreamClient, cfg.IdentityBaseURL, cfg.ChatBaseURL)
	realtimeHub := realtime.NewHub(logger, cfg.RealtimePingInterval, cfg.RealtimeWriteTimeout)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	defer realtimeHub.Close()

	go func() {
		<-ctx.Done()
		realtimeHub.Close()
	}()

	handler := app.NewHTTPHandler(
		logger,
		observability.ServiceMeta{
			Name:    serviceName,
			Version: version,
		},
		cfg,
		clients,
		realtimeHub,
	)

	if err := observability.RunHTTPServer(ctx, logger, observability.HTTPServerConfig{
		Address:         cfg.HTTPAddress,
		ShutdownTimeout: cfg.ShutdownTimeout,
	}, handler); err != nil && !errors.Is(err, context.Canceled) {
		return err
	}

	logger.Info("сервис остановлен")

	return nil
}
