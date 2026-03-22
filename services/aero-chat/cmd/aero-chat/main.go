package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	libauth "github.com/MattoYuzuru/AeroChat/libs/go/auth"
	"github.com/MattoYuzuru/AeroChat/libs/go/dbbootstrap"
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
	chatschema "github.com/MattoYuzuru/AeroChat/services/aero-chat/db/schema"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/app"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	miniostorage "github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/storage/minio"
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
				Migration:   "000003_crypto_device_registry_foundation.sql",
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
	objectStorage, err := miniostorage.NewClient(
		cfg.MediaS3InternalEndpoint,
		cfg.MediaS3InternalSecure,
		cfg.MediaS3PresignEndpoint,
		cfg.MediaS3PresignSecure,
		cfg.MediaS3AccessKey,
		cfg.MediaS3SecretKey,
		cfg.MediaS3BucketName,
	)
	if err != nil {
		return err
	}
	if err := objectStorage.EnsureBucket(context.Background()); err != nil {
		return err
	}

	service := chat.NewService(
		repository,
		repository,
		typingStore,
		presenceStore,
		objectStorage,
		libauth.NewSessionTokenManager(),
		cfg.DirectChatTypingTTL,
		cfg.DirectChatPresenceTTL,
		cfg.MediaUploadIntentTTL,
		cfg.MediaMaxUploadSizeBytes,
		cfg.MediaUserQuotaBytes,
		cfg.MaxActiveGroupMembershipsPerUser,
		cfg.MediaS3BucketName,
	)
	handler := connecthandler.NewHandler(serviceName, version, service)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	startAttachmentLifecycleCleanupLoop(ctx, logger, service, cfg)

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

func startAttachmentLifecycleCleanupLoop(ctx context.Context, logger *slog.Logger, service *chat.Service, cfg app.Config) {
	if cfg.MediaAttachmentCleanupInterval <= 0 {
		logger.Info("attachment lifecycle cleanup отключён", slog.Duration("interval", cfg.MediaAttachmentCleanupInterval))
		return
	}

	runCleanup := func() {
		report, err := service.RunAttachmentLifecycleCleanup(ctx, chat.AttachmentLifecycleCleanupOptions{
			Now:               time.Now().UTC(),
			UnattachedTTL:     cfg.MediaUnattachedAttachmentTTL,
			DetachedRetention: cfg.MediaDetachedAttachmentRetention,
			BatchSize:         cfg.MediaAttachmentCleanupBatchSize,
		})
		if err != nil {
			logger.Error("attachment lifecycle cleanup завершился с ошибкой", slog.String("error", err.Error()))
			return
		}
		if report.ExpiredUploadSessions == 0 && report.ExpiredOrphanAttachments == 0 && report.DeletedAttachments == 0 {
			return
		}

		logger.Info(
			"attachment lifecycle cleanup завершён",
			slog.Int64("expired_upload_sessions", report.ExpiredUploadSessions),
			slog.Int64("expired_orphan_attachments", report.ExpiredOrphanAttachments),
			slog.Int("deleted_attachments", report.DeletedAttachments),
		)
	}

	runCleanup()

	go func() {
		ticker := time.NewTicker(cfg.MediaAttachmentCleanupInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runCleanup()
			}
		}
	}()
}
