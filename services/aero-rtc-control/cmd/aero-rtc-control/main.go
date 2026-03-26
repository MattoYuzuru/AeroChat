package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/MattoYuzuru/AeroChat/libs/go/dbbootstrap"
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
	rtcschema "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/db/schema"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/app"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/rtc"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/downstream"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/storage/postgres"
	connecthandler "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/transport/connect"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	serviceName       = "aero-rtc-control"
	defaultHTTPServer = ":8083"
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
	if err := dbbootstrap.Apply(context.Background(), db, dbbootstrap.Options{
		ServiceName: "aero-rtc-control",
		Files:       rtcschema.Files,
		Logger:      logger,
		WaitTimeout: cfg.DatabaseBootstrapTimeout,
		Requirements: []dbbootstrap.Requirement{
			{
				ServiceName: "aero-identity",
				Migration:   "000001_identity_foundation.sql",
			},
			{
				ServiceName: "aero-chat",
				Migration:   "000003_group_foundation.sql",
			},
		},
	}); err != nil {
		return fmt.Errorf("rtc-control database bootstrap: %w", err)
	}

	downstreamClient := downstream.NewHTTPClient(cfg.DownstreamTimeout)
	clients := downstream.NewClients(downstreamClient, cfg.IdentityBaseURL, cfg.ChatBaseURL)
	service := rtc.NewService(
		repository,
		downstream.NewIdentityAuthenticator(clients.Identity),
		downstream.NewChatScopeAuthorizer(clients.Chat),
		cfg.MaxSignalPayloadSizeBytes,
	).WithICEServerProvider(
		rtc.NewConfigurableICEServerProvider(
			cfg.STUNServerURLs,
			cfg.TURNServerURLs,
			cfg.TURNAuthSecret,
			cfg.TURNUsernameTTL,
		),
	)
	handler := connecthandler.NewHandler(serviceName, version, service)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	httpHandler := app.NewHTTPHandler(
		logger,
		observability.ServiceMeta{
			Name:    serviceName,
			Version: version,
		},
		func(ctx context.Context) error {
			if err := repository.Ping(ctx); err != nil {
				return err
			}

			return clients.ReadinessCheck(ctx)
		},
		handler,
	)

	if err := observability.RunHTTPServer(ctx, logger, observability.HTTPServerConfig{
		Address:         cfg.HTTPAddress,
		ShutdownTimeout: cfg.ShutdownTimeout,
	}, httpHandler); err != nil && !errors.Is(err, context.Canceled) {
		return err
	}

	logger.Info("сервис остановлен")

	return nil
}
