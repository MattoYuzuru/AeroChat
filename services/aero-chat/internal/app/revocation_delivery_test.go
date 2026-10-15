package app

import "testing"

func TestChatDeliveryConfigDefaultOffAndStrict(t *testing.T) {
	t.Setenv("AERO_CHAT_RTC_REVOCATION_DELIVERY_ENABLED", "false")
	cfg, err := loadRevocationDeliveryConfig()
	if err != nil || cfg.Enabled {
		t.Fatal("worker must default off")
	}
	t.Setenv("AERO_CHAT_RTC_REVOCATION_DELIVERY_ENABLED", "invalid")
	if _, err := loadRevocationDeliveryConfig(); err == nil {
		t.Fatal("invalid enabled flag accepted")
	}
	t.Setenv("AERO_CHAT_RTC_REVOCATION_DELIVERY_ENABLED", "true")
	if _, err := loadRevocationDeliveryConfig(); err == nil {
		t.Fatal("enabled worker requires explicit authority/TLS")
	}
}
