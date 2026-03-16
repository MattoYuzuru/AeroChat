package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	identityv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1/identityv1connect"
	libauth "github.com/MattoYuzuru/AeroChat/libs/go/auth"
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/app"
	identityauth "github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/auth"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/domain/identity"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/storage/postgres"
	connecthandler "github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/transport/connect"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	serviceName       = "aero-identity"
	defaultHTTPServer = ":8081"
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

	db, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()

	repository := postgres.NewRepository(db)
	if err := repository.Ping(context.Background()); err != nil {
		return err
	}

	service := identity.NewService(
		repository,
		identityauth.NewPasswordHasher(),
		libauth.NewSessionTokenManager(),
	)
	handler := connecthandler.NewHandler(serviceName, version, service)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	mux := observability.NewBaseMux(
		observability.ServiceMeta{
			Name:    serviceName,
			Version: version,
		},
		logger,
		repository.Ping,
	)
	path, connectHTTPHandler := identityv1connect.NewIdentityServiceHandler(handler)
	mux.Handle(path, connectHTTPHandler)

	if err := observability.RunHTTPServer(ctx, logger, observability.HTTPServerConfig{
		Address:         cfg.HTTPAddress,
		ShutdownTimeout: cfg.ShutdownTimeout,
	}, mux); err != nil && !errors.Is(err, context.Canceled) {
		return err
	}

	logger.Info("сервис остановлен")

	return nil
}
