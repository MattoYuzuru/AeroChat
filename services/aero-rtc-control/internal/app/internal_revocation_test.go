package app

import (
	"io"
	"log/slog"
	"testing"
)

func TestPrivateRevocationDefaultOffAndStrictConfig(t *testing.T) {
	for _, key := range []string{"ENABLED", "LISTEN_ADDR", "TLS_CERT_FILE", "TLS_KEY_FILE", "CLIENT_CA_FILE"} {
		t.Setenv("AERO_RTC_INTERNAL_REVOCATION_"+key, "")
	}
	cfg, err := loadInternalRevocationConfig()
	if err != nil || cfg.Enabled {
		t.Fatal("private receiver must default off")
	}
	server, err := NewInternalRevocationServer(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	if err != nil || server != nil {
		t.Fatal("disabled receiver started")
	}
	t.Setenv("AERO_RTC_INTERNAL_REVOCATION_ENABLED", "bad")
	if _, err := loadInternalRevocationConfig(); err == nil {
		t.Fatal("invalid enable flag accepted")
	}
	t.Setenv("AERO_RTC_INTERNAL_REVOCATION_ENABLED", "true")
	for _, address := range []string{"", ":8087", "localhost:no", "localhost:65536"} {
		t.Setenv("AERO_RTC_INTERNAL_REVOCATION_LISTEN_ADDR", address)
		if _, err := loadInternalRevocationConfig(); err == nil {
			t.Fatal("invalid private address accepted")
		}
	}
	t.Setenv("AERO_RTC_INTERNAL_REVOCATION_LISTEN_ADDR", "127.0.0.1:0")
	if _, err := loadInternalRevocationConfig(); err == nil {
		t.Fatal("missing TLS files accepted")
	}
	for _, key := range []string{"TLS_CERT_FILE", "TLS_KEY_FILE", "CLIENT_CA_FILE"} {
		t.Setenv("AERO_RTC_INTERNAL_REVOCATION_"+key, "missing-owned-test-file")
	}
	cfg, err = loadInternalRevocationConfig()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewInternalRevocationServer(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), nil); err == nil {
		t.Fatal("bad keypair must fail closed")
	}
}
