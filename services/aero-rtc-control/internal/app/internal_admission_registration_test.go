package app

import (
	"io"
	"log/slog"
	"testing"
)

func TestAdmissionRegistrationDefaultOffAndStrictConfiguration(t *testing.T) {
	t.Setenv("AERO_RTC_INTERNAL_ADMISSION_REGISTRATION_ENABLED", "false")
	cfg, err := loadInternalAdmissionRegistrationConfig()
	if err != nil || cfg.Enabled {
		t.Fatal("registration must default off")
	}
	server, err := NewInternalAdmissionRegistrationServer(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	if err != nil || server != nil {
		t.Fatal("disabled registration constructed listener")
	}
	t.Setenv("AERO_RTC_INTERNAL_ADMISSION_REGISTRATION_ENABLED", "invalid")
	if _, err := loadInternalAdmissionRegistrationConfig(); err == nil {
		t.Fatal("invalid flag accepted")
	}
	t.Setenv("AERO_RTC_INTERNAL_ADMISSION_REGISTRATION_ENABLED", "true")
	if _, err := loadInternalAdmissionRegistrationConfig(); err == nil {
		t.Fatal("enabled registration missing address/TLS accepted")
	}
	for _, address := range []string{":1", "localhost:65536", "localhost:bad"} {
		if (InternalAdmissionRegistrationConfig{Enabled: true, Address: address, TLSCertFile: "cert", TLSKeyFile: "key", ClientCAFile: "ca"}).validate() == nil {
			t.Fatal("invalid address accepted")
		}
	}
}
