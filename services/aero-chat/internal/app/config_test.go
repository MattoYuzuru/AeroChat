package app

import (
	"testing"
	"time"
)

func TestLoadConfigDefaults(t *testing.T) {
	t.Setenv("AERO_DATABASE_URL", "")
	t.Setenv("AERO_REDIS_ADDR", "")
	t.Setenv("AERO_HTTP_ADDR", "")
	t.Setenv("AERO_LOG_LEVEL", "")
	t.Setenv("AERO_SHUTDOWN_TIMEOUT", "")
	t.Setenv("AERO_DATABASE_BOOTSTRAP_TIMEOUT", "")
	t.Setenv("AERO_DIRECT_CHAT_TYPING_TTL", "")
	t.Setenv("AERO_DIRECT_CHAT_PRESENCE_TTL", "")
	t.Setenv("AERO_MEDIA_S3_INTERNAL_ENDPOINT", "")
	t.Setenv("AERO_MEDIA_S3_PRESIGN_ENDPOINT", "")
	t.Setenv("AERO_MEDIA_S3_ACCESS_KEY", "")
	t.Setenv("AERO_MEDIA_S3_SECRET_KEY", "")
	t.Setenv("AERO_MEDIA_S3_BUCKET", "")
	t.Setenv("AERO_MEDIA_S3_INTERNAL_SECURE", "")
	t.Setenv("AERO_MEDIA_S3_PRESIGN_SECURE", "")
	t.Setenv("AERO_MEDIA_UPLOAD_INTENT_TTL", "")
	t.Setenv("AERO_MEDIA_MAX_UPLOAD_SIZE_BYTES", "")
	t.Setenv("AERO_MEDIA_USER_QUOTA_BYTES", "")
	t.Setenv("AERO_MEDIA_ATTACHMENT_CLEANUP_INTERVAL", "")
	t.Setenv("AERO_MEDIA_UNATTACHED_ATTACHMENT_TTL", "")
	t.Setenv("AERO_MEDIA_ATTACHMENT_CLEANUP_BATCH_SIZE", "")

	cfg, err := LoadConfig(":8082")
	if err != nil {
		t.Fatalf("ожидалась валидная конфигурация по умолчанию: %v", err)
	}

	if cfg.DatabaseURL == "" {
		t.Fatal("ожидался database url по умолчанию")
	}
	if cfg.RedisAddress != "localhost:6379" {
		t.Fatalf("ожидался redis address по умолчанию, получен %q", cfg.RedisAddress)
	}
	if cfg.DatabaseBootstrapTimeout != 30*time.Second {
		t.Fatalf("ожидался database bootstrap timeout по умолчанию, получен %s", cfg.DatabaseBootstrapTimeout)
	}
	if cfg.MediaS3InternalEndpoint != "localhost:9000" {
		t.Fatalf("ожидался media internal endpoint по умолчанию, получен %q", cfg.MediaS3InternalEndpoint)
	}
	if cfg.MediaS3PresignEndpoint != "127.0.0.1:9000" {
		t.Fatalf("ожидался media presign endpoint по умолчанию, получен %q", cfg.MediaS3PresignEndpoint)
	}
	if cfg.MediaUploadIntentTTL != 15*time.Minute {
		t.Fatalf("ожидался media upload intent ttl по умолчанию, получен %s", cfg.MediaUploadIntentTTL)
	}
	if cfg.MediaMaxUploadSizeBytes != 64*1024*1024 {
		t.Fatalf("ожидался media max upload size по умолчанию, получен %d", cfg.MediaMaxUploadSizeBytes)
	}
	if cfg.MediaUserQuotaBytes != 512*1024*1024 {
		t.Fatalf("ожидалась media user quota по умолчанию, получена %d", cfg.MediaUserQuotaBytes)
	}
	if cfg.MediaAttachmentCleanupInterval != 10*time.Minute {
		t.Fatalf("ожидался cleanup interval по умолчанию, получен %s", cfg.MediaAttachmentCleanupInterval)
	}
	if cfg.MediaUnattachedAttachmentTTL != 24*time.Hour {
		t.Fatalf("ожидался unattached attachment ttl по умолчанию, получен %s", cfg.MediaUnattachedAttachmentTTL)
	}
	if cfg.MediaAttachmentCleanupBatchSize != 100 {
		t.Fatalf("ожидался cleanup batch size по умолчанию, получен %d", cfg.MediaAttachmentCleanupBatchSize)
	}
}

func TestLoadConfigRejectsInvalidBootstrapDuration(t *testing.T) {
	t.Setenv("AERO_DATABASE_BOOTSTRAP_TIMEOUT", "later")

	if _, err := LoadConfig(":8082"); err == nil {
		t.Fatal("ожидалась ошибка для невалидного database bootstrap timeout")
	}
}

func TestLoadConfigRejectsInvalidAttachmentCleanupBatchSize(t *testing.T) {
	t.Setenv("AERO_MEDIA_ATTACHMENT_CLEANUP_BATCH_SIZE", "many")

	if _, err := LoadConfig(":8082"); err == nil {
		t.Fatal("ожидалась ошибка для невалидного cleanup batch size")
	}
}

func TestLoadConfigRejectsNonPositiveMediaUserQuotaBytes(t *testing.T) {
	t.Setenv("AERO_MEDIA_USER_QUOTA_BYTES", "0")

	if _, err := LoadConfig(":8082"); err == nil {
		t.Fatal("ожидалась ошибка для неположительной media user quota")
	}
}
