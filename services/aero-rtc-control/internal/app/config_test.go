package app

import (
	"testing"
	"time"
)

func TestLoadConfigDefaults(t *testing.T) {
	t.Setenv("AERO_DATABASE_URL", "")
	t.Setenv("AERO_HTTP_ADDR", "")
	t.Setenv("AERO_LOG_LEVEL", "")
	t.Setenv("AERO_SHUTDOWN_TIMEOUT", "")
	t.Setenv("AERO_DATABASE_BOOTSTRAP_TIMEOUT", "")
	t.Setenv("AERO_DOWNSTREAM_TIMEOUT", "")
	t.Setenv("AERO_RTC_TURN_USERNAME_TTL", "")
	t.Setenv("AERO_IDENTITY_URL", "")
	t.Setenv("AERO_CHAT_URL", "")
	t.Setenv("AERO_RTC_STUN_URLS", "")
	t.Setenv("AERO_RTC_TURN_URLS", "")
	t.Setenv("AERO_RTC_TURN_AUTH_SECRET", "")
	t.Setenv("AERO_RTC_SIGNAL_MAX_PAYLOAD_BYTES", "")

	cfg, err := LoadConfig(":8083")
	if err != nil {
		t.Fatalf("ожидалась валидная конфигурация по умолчанию: %v", err)
	}

	if cfg.HTTPAddress != ":8083" {
		t.Fatalf("ожидался http адрес по умолчанию, получен %q", cfg.HTTPAddress)
	}
	if cfg.IdentityBaseURL != "http://127.0.0.1:8081" {
		t.Fatalf("ожидался identity url по умолчанию, получен %q", cfg.IdentityBaseURL)
	}
	if cfg.ChatBaseURL != "http://127.0.0.1:8082" {
		t.Fatalf("ожидался chat url по умолчанию, получен %q", cfg.ChatBaseURL)
	}
	if len(cfg.STUNServerURLs) != 1 || cfg.STUNServerURLs[0] != "stun:stun.cloudflare.com:3478" {
		t.Fatalf("ожидался дефолтный stun url, получено %#v", cfg.STUNServerURLs)
	}
	if len(cfg.TURNServerURLs) != 0 {
		t.Fatalf("ожидались пустые turn urls по умолчанию, получено %#v", cfg.TURNServerURLs)
	}
	if cfg.TURNAuthSecret != "" {
		t.Fatalf("ожидался пустой turn secret по умолчанию, получен %q", cfg.TURNAuthSecret)
	}
	if cfg.TURNUsernameTTL != 10*time.Minute {
		t.Fatalf("ожидался turn ttl по умолчанию 10m, получен %s", cfg.TURNUsernameTTL)
	}
	if cfg.MaxSignalPayloadSizeBytes != 16*1024 {
		t.Fatalf("ожидался дефолтный signal payload limit 16384, получен %d", cfg.MaxSignalPayloadSizeBytes)
	}
}

func TestLoadConfigRejectsInvalidRTCURL(t *testing.T) {
	t.Setenv("AERO_CHAT_URL", "/chat")

	if _, err := LoadConfig(":8083"); err == nil {
		t.Fatal("ожидалась ошибка для невалидного chat url")
	}
}

func TestLoadConfigRejectsNonPositiveSignalLimit(t *testing.T) {
	t.Setenv("AERO_RTC_SIGNAL_MAX_PAYLOAD_BYTES", "0")

	if _, err := LoadConfig(":8083"); err == nil {
		t.Fatal("ожидалась ошибка для нулевого signal payload limit")
	}
}
