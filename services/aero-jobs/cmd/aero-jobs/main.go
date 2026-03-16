package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
	"github.com/MattoYuzuru/AeroChat/services/aero-jobs/internal/app"
)

const (
	serviceName       = "aero-jobs"
	defaultHTTPServer = ":8084"
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

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	mux := observability.NewBaseMux(
		observability.ServiceMeta{
			Name:    serviceName,
			Version: version,
		},
		logger,
		nil,
	)

	if err := observability.RunHTTPServer(ctx, logger, observability.HTTPServerConfig{
		Address:         cfg.HTTPAddress,
		ShutdownTimeout: cfg.ShutdownTimeout,
	}, mux); err != nil && !errors.Is(err, context.Canceled) {
		return err
	}

	logger.Info("сервис остановлен")

	return nil
}
