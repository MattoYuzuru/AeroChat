package app

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config описывает минимальную runtime-конфигурацию сервиса.
type Config struct {
	DatabaseURL                     string
	RedisAddress                    string
	HTTPAddress                     string
	LogLevel                        string
	ShutdownTimeout                 time.Duration
	DatabaseBootstrapTimeout        time.Duration
	DirectChatTypingTTL             time.Duration
	DirectChatPresenceTTL           time.Duration
	MediaS3InternalEndpoint         string
	MediaS3PresignEndpoint          string
	MediaS3AccessKey                string
	MediaS3SecretKey                string
	MediaS3BucketName               string
	MediaS3InternalSecure           bool
	MediaS3PresignSecure            bool
	MediaUploadIntentTTL            time.Duration
	MediaMaxUploadSizeBytes         int64
	MediaAttachmentCleanupInterval  time.Duration
	MediaUnattachedAttachmentTTL    time.Duration
	MediaAttachmentCleanupBatchSize int
}

// LoadConfig загружает конфигурацию из env с безопасными значениями по умолчанию.
func LoadConfig(defaultHTTPAddress string) (Config, error) {
	shutdownTimeout, err := lookupDuration("AERO_SHUTDOWN_TIMEOUT", 10*time.Second)
	if err != nil {
		return Config{}, err
	}
	bootstrapTimeout, err := lookupDuration("AERO_DATABASE_BOOTSTRAP_TIMEOUT", 30*time.Second)
	if err != nil {
		return Config{}, err
	}
	typingTTL, err := lookupDuration("AERO_DIRECT_CHAT_TYPING_TTL", 6*time.Second)
	if err != nil {
		return Config{}, err
	}
	presenceTTL, err := lookupDuration("AERO_DIRECT_CHAT_PRESENCE_TTL", 30*time.Second)
	if err != nil {
		return Config{}, err
	}
	uploadIntentTTL, err := lookupDuration("AERO_MEDIA_UPLOAD_INTENT_TTL", 15*time.Minute)
	if err != nil {
		return Config{}, err
	}
	attachmentCleanupInterval, err := lookupDuration("AERO_MEDIA_ATTACHMENT_CLEANUP_INTERVAL", 10*time.Minute)
	if err != nil {
		return Config{}, err
	}
	unattachedAttachmentTTL, err := lookupDuration("AERO_MEDIA_UNATTACHED_ATTACHMENT_TTL", 24*time.Hour)
	if err != nil {
		return Config{}, err
	}
	maxUploadSizeBytes, err := lookupInt64("AERO_MEDIA_MAX_UPLOAD_SIZE_BYTES", 64*1024*1024)
	if err != nil {
		return Config{}, err
	}
	attachmentCleanupBatchSize, err := lookupInt("AERO_MEDIA_ATTACHMENT_CLEANUP_BATCH_SIZE", 100)
	if err != nil {
		return Config{}, err
	}

	return Config{
		DatabaseURL:                     lookupString("AERO_DATABASE_URL", "postgres://aerochat:aerochat@localhost:5432/aerochat?sslmode=disable"),
		RedisAddress:                    lookupString("AERO_REDIS_ADDR", "localhost:6379"),
		HTTPAddress:                     lookupString("AERO_HTTP_ADDR", defaultHTTPAddress),
		LogLevel:                        lookupString("AERO_LOG_LEVEL", "info"),
		ShutdownTimeout:                 shutdownTimeout,
		DatabaseBootstrapTimeout:        bootstrapTimeout,
		DirectChatTypingTTL:             typingTTL,
		DirectChatPresenceTTL:           presenceTTL,
		MediaS3InternalEndpoint:         lookupString("AERO_MEDIA_S3_INTERNAL_ENDPOINT", "localhost:9000"),
		MediaS3PresignEndpoint:          lookupString("AERO_MEDIA_S3_PRESIGN_ENDPOINT", "127.0.0.1:9000"),
		MediaS3AccessKey:                lookupString("AERO_MEDIA_S3_ACCESS_KEY", "minioadmin"),
		MediaS3SecretKey:                lookupString("AERO_MEDIA_S3_SECRET_KEY", "minioadmin"),
		MediaS3BucketName:               lookupString("AERO_MEDIA_S3_BUCKET", "aerochat-attachments"),
		MediaS3InternalSecure:           lookupBool("AERO_MEDIA_S3_INTERNAL_SECURE", false),
		MediaS3PresignSecure:            lookupBool("AERO_MEDIA_S3_PRESIGN_SECURE", false),
		MediaUploadIntentTTL:            uploadIntentTTL,
		MediaMaxUploadSizeBytes:         maxUploadSizeBytes,
		MediaAttachmentCleanupInterval:  attachmentCleanupInterval,
		MediaUnattachedAttachmentTTL:    unattachedAttachmentTTL,
		MediaAttachmentCleanupBatchSize: attachmentCleanupBatchSize,
	}, nil
}

func lookupString(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	return value
}

func lookupDuration(key string, fallback time.Duration) (time.Duration, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}

	parsed, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("переменная %s: %w", key, err)
	}

	return parsed, nil
}

func lookupBool(key string, fallback bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	switch value {
	case "1", "true", "TRUE", "True", "yes", "YES", "Yes", "on", "ON", "On":
		return true
	case "0", "false", "FALSE", "False", "no", "NO", "No", "off", "OFF", "Off":
		return false
	default:
		return fallback
	}
}

func lookupInt64(key string, fallback int64) (int64, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}

	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("переменная %s: %w", key, err)
	}

	return parsed, nil
}

func lookupInt(key string, fallback int) (int, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}

	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("переменная %s: %w", key, err)
	}

	return parsed, nil
}
