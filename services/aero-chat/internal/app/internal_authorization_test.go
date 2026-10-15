package app

import (
	"io"
	"log/slog"
	"testing"
)

func TestPrivateGroupAuthorizationConfigurationFailsClosed(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	server, err := NewInternalAuthorizationServer(InternalAuthorizationConfig{}, logger, nil)
	if err != nil || server != nil {
		t.Fatal("disabled private listener was created")
	}
	for _, cfg := range []InternalAuthorizationConfig{
		{Enabled: true},
		{Enabled: true, Address: ":8444"},
		{Enabled: true, Address: "127.0.0.1:65536"},
		{Enabled: true, Address: "127.0.0.1:8444"},
		{Enabled: true, Address: "127.0.0.1:8444", TLSCertFile: "missing-owned-cert", TLSKeyFile: "missing-owned-key", ClientCAFile: "missing-owned-ca"},
	} {
		if server, err := NewInternalAuthorizationServer(cfg, logger, nil); err == nil || server != nil {
			t.Fatal("invalid enabled listener accepted")
		}
	}
	t.Setenv("AERO_CHAT_INTERNAL_AUTHORIZATION_ENABLED", "unsupported")
	if _, err := LoadConfig(":8082"); err == nil {
		t.Fatal("invalid enable flag accepted")
	}
	t.Setenv("AERO_CHAT_INTERNAL_AUTHORIZATION_ENABLED", "false")
	cfg, err := loadInternalAuthorizationConfig()
	if err != nil || cfg.Enabled {
		t.Fatal("default-disabled flag not respected")
	}
}
