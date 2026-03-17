package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	libauth "github.com/MattoYuzuru/AeroChat/libs/go/auth"
	"github.com/MattoYuzuru/AeroChat/libs/go/dbbootstrap"
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
	chatschema "github.com/MattoYuzuru/AeroChat/services/aero-chat/db/schema"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/app"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/storage/postgres"
	redisstate "github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/storage/redis"
	connecthandler "github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/transport/connect"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	serviceName       = "aero-chat"
	defaultHTTPServer = ":8082"
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
		ServiceName: "aero-chat",
		Files:       chatschema.Files,
		Logger:      logger,
		WaitTimeout: cfg.DatabaseBootstrapTimeout,
		Requirements: []dbbootstrap.Requirement{
			{
				ServiceName: "aero-identity",
				Migration:   "000002_social_graph_foundation.sql",
			},
		},
	}); err != nil {
		return fmt.Errorf("chat database bootstrap: %w", err)
	}

	typingStore := redisstate.NewTypingStore(cfg.RedisAddress)
	defer func() {
		_ = typingStore.Close()
	}()
	if err := typingStore.Ping(context.Background()); err != nil {
		return err
	}
	presenceStore := redisstate.NewPresenceStore(cfg.RedisAddress)
	defer func() {
		_ = presenceStore.Close()
	}()
	if err := presenceStore.Ping(context.Background()); err != nil {
		return err
	}

	service := chat.NewService(
		repository,
		repository,
		typingStore,
		presenceStore,
		libauth.NewSessionTokenManager(),
		cfg.DirectChatTypingTTL,
		cfg.DirectChatPresenceTTL,
	)
	handler := connecthandler.NewHandler(serviceName, version, service)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	meta := observability.ServiceMeta{
		Name:    serviceName,
		Version: version,
	}
	httpHandler := app.NewHTTPHandler(
		logger,
		meta,
		func(ctx context.Context) error {
			if err := repository.Ping(ctx); err != nil {
				return err
			}
			if err := presenceStore.Ping(ctx); err != nil {
				return err
			}

			return typingStore.Ping(ctx)
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
