package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	chatv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1/chatv1connect"
	libauth "github.com/MattoYuzuru/AeroChat/libs/go/auth"
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
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

	typingStore := redisstate.NewTypingStore(cfg.RedisAddress)
	defer func() {
		_ = typingStore.Close()
	}()
	if err := typingStore.Ping(context.Background()); err != nil {
		return err
	}

	service := chat.NewService(
		repository,
		repository,
		typingStore,
		libauth.NewSessionTokenManager(),
		cfg.DirectChatTypingTTL,
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
		func(ctx context.Context) error {
			if err := repository.Ping(ctx); err != nil {
				return err
			}

			return typingStore.Ping(ctx)
		},
	)
	path, connectHTTPHandler := chatv1connect.NewChatServiceHandler(handler)
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
