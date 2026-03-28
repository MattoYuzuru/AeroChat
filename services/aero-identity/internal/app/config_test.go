package app

import (
	"os"
	"testing"
	"time"
)

func TestLoadConfigDefaults(t *testing.T) {
	t.Setenv("AERO_DATABASE_URL", "")
	t.Setenv("AERO_HTTP_ADDR", "")
	t.Setenv("AERO_LOG_LEVEL", "")
	t.Setenv("AERO_SHUTDOWN_TIMEOUT", "")
	t.Setenv("AERO_DATABASE_BOOTSTRAP_TIMEOUT", "")

	cfg, err := LoadConfig(":8081")
	if err != nil {
		t.Fatalf("ожидалась валидная конфигурация по умолчанию: %v", err)
	}

	if cfg.DatabaseURL == "" {
		t.Fatal("ожидался database url по умолчанию")
	}
	if cfg.HTTPAddress != ":8081" {
		t.Fatalf("ожидался http адрес по умолчанию, получен %q", cfg.HTTPAddress)
	}
	if cfg.DatabaseBootstrapTimeout != 30*time.Second {
		t.Fatalf("ожидался database bootstrap timeout по умолчанию, получен %s", cfg.DatabaseBootstrapTimeout)
	}
}

func TestLoadConfigRejectsInvalidDuration(t *testing.T) {
	t.Setenv("AERO_SHUTDOWN_TIMEOUT", "never")

	if _, err := LoadConfig(":8081"); err == nil {
		t.Fatal("ожидалась ошибка для невалидного shutdown timeout")
	}
}

func TestLoadConfigRejectsInvalidBootstrapDuration(t *testing.T) {
	t.Setenv("AERO_DATABASE_BOOTSTRAP_TIMEOUT", "later")

	if _, err := LoadConfig(":8081"); err == nil {
		t.Fatal("ожидалась ошибка для невалидного database bootstrap timeout")
	}
}

func TestLoadConfigRejectsPartialWebPushConfig(t *testing.T) {
	t.Setenv("AERO_WEB_PUSH_SUBSCRIBER", "mailto:test@example.com")
	t.Setenv("AERO_WEB_PUSH_VAPID_PUBLIC_KEY", "")
	t.Setenv("AERO_WEB_PUSH_VAPID_PRIVATE_KEY", "")

	if _, err := LoadConfig(":8081"); err == nil {
		t.Fatal("ожидалась ошибка для неполной web push конфигурации")
	}
}

func TestLookupStringUsesFallback(t *testing.T) {
	if err := os.Unsetenv("AERO_SAMPLE_ENV"); err != nil {
		t.Fatalf("unset env: %v", err)
	}

	if value := lookupString("AERO_SAMPLE_ENV", "fallback"); value != "fallback" {
		t.Fatalf("ожидался fallback, получено %q", value)
	}
}
