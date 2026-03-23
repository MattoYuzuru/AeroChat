package app

import "testing"

func TestLoadConfigDefaults(t *testing.T) {
	t.Setenv("AERO_HTTP_ADDR", "")
	t.Setenv("AERO_LOG_LEVEL", "")
	t.Setenv("AERO_SHUTDOWN_TIMEOUT", "")
	t.Setenv("AERO_DOWNSTREAM_TIMEOUT", "")
	t.Setenv("AERO_REALTIME_PING_INTERVAL", "")
	t.Setenv("AERO_REALTIME_WRITE_TIMEOUT", "")
	t.Setenv("AERO_IDENTITY_URL", "")
	t.Setenv("AERO_CHAT_URL", "")
	t.Setenv("AERO_RTC_CONTROL_URL", "")
	t.Setenv("AERO_CORS_ALLOWED_ORIGINS", "")

	cfg, err := LoadConfig(":8080")
	if err != nil {
		t.Fatalf("ожидалась валидная конфигурация по умолчанию: %v", err)
	}

	if cfg.HTTPAddress != ":8080" {
		t.Fatalf("ожидался http адрес по умолчанию, получен %q", cfg.HTTPAddress)
	}
	if cfg.IdentityBaseURL != "http://127.0.0.1:8081" {
		t.Fatalf("ожидался identity url по умолчанию, получен %q", cfg.IdentityBaseURL)
	}
	if cfg.ChatBaseURL != "http://127.0.0.1:8082" {
		t.Fatalf("ожидался chat url по умолчанию, получен %q", cfg.ChatBaseURL)
	}
	if cfg.RTCBaseURL != "http://127.0.0.1:8083" {
		t.Fatalf("ожидался rtc url по умолчанию, получен %q", cfg.RTCBaseURL)
	}
	if cfg.DownstreamTimeout.String() != "5s" {
		t.Fatalf("ожидался downstream timeout 5s, получен %s", cfg.DownstreamTimeout)
	}
	if cfg.RealtimePingInterval.String() != "30s" {
		t.Fatalf("ожидался realtime ping interval 30s, получен %s", cfg.RealtimePingInterval)
	}
	if cfg.RealtimeWriteTimeout.String() != "10s" {
		t.Fatalf("ожидался realtime write timeout 10s, получен %s", cfg.RealtimeWriteTimeout)
	}
	if len(cfg.CORSAllowedOrigins) != 0 {
		t.Fatalf("ожидался пустой список cors origins, получено %v", cfg.CORSAllowedOrigins)
	}
}

func TestLoadConfigRejectsInvalidDuration(t *testing.T) {
	t.Setenv("AERO_DOWNSTREAM_TIMEOUT", "forever")

	if _, err := LoadConfig(":8080"); err == nil {
		t.Fatal("ожидалась ошибка для невалидного downstream timeout")
	}
}

func TestLoadConfigRejectsNonPositiveRealtimePingInterval(t *testing.T) {
	t.Setenv("AERO_REALTIME_PING_INTERVAL", "0s")

	if _, err := LoadConfig(":8080"); err == nil {
		t.Fatal("ожидалась ошибка для нулевого realtime ping interval")
	}
}

func TestLoadConfigRejectsInvalidDownstreamURL(t *testing.T) {
	t.Setenv("AERO_IDENTITY_URL", "/identity")

	if _, err := LoadConfig(":8080"); err == nil {
		t.Fatal("ожидалась ошибка для невалидного identity url")
	}
}

func TestLookupCSVSkipsEmptyValues(t *testing.T) {
	t.Setenv("AERO_SAMPLE_CSV", " http://localhost:5173, ,http://localhost:4173 ")

	values := lookupCSV("AERO_SAMPLE_CSV")
	if len(values) != 2 {
		t.Fatalf("ожидалось 2 значения, получено %d", len(values))
	}
	if values[0] != "http://localhost:5173" || values[1] != "http://localhost:4173" {
		t.Fatalf("получен неожиданный список: %v", values)
	}
}
