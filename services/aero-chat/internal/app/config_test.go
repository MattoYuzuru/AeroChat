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
}

func TestLoadConfigRejectsInvalidBootstrapDuration(t *testing.T) {
	t.Setenv("AERO_DATABASE_BOOTSTRAP_TIMEOUT", "later")

	if _, err := LoadConfig(":8082"); err == nil {
		t.Fatal("ожидалась ошибка для невалидного database bootstrap timeout")
	}
}
