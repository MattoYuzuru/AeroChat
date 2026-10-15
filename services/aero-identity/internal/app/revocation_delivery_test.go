package app

import "testing"

func TestRevocationDeliveryConfigDefaultOffAndStrict(t *testing.T) {
	t.Setenv("AERO_IDENTITY_RTC_REVOCATION_DELIVERY_ENABLED", "false")
	cfg, err := loadRevocationDeliveryConfig()
	if err != nil || cfg.Enabled {
		t.Fatal("delivery must default off")
	}
	t.Setenv("AERO_IDENTITY_RTC_REVOCATION_DELIVERY_ENABLED", "invalid")
	if _, err := loadRevocationDeliveryConfig(); err == nil {
		t.Fatal("invalid flag accepted")
	}
	t.Setenv("AERO_IDENTITY_RTC_REVOCATION_DELIVERY_ENABLED", "true")
	if _, err := loadRevocationDeliveryConfig(); err == nil {
		t.Fatal("enabled worker requires explicit authority/TLS")
	}
}
