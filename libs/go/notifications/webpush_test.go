package notifications

import "testing"

func TestValidateWebPushConfigAllowsDisabledState(t *testing.T) {
	if err := ValidateWebPushConfig("", "", ""); err != nil {
		t.Fatalf("ожидалось, что полностью пустой push config считается корректным disabled state: %v", err)
	}
}

func TestValidateWebPushConfigRejectsPartialState(t *testing.T) {
	err := ValidateWebPushConfig("mailto:test@example.com", "", "")
	if err == nil {
		t.Fatal("ожидалась ошибка для неполной web push конфигурации")
	}
}

func TestWebPushConfigEnabled(t *testing.T) {
	if !WebPushConfigEnabled("mailto:test@example.com", "public", "private") {
		t.Fatal("ожидалась включенная web push конфигурация")
	}

	if WebPushConfigEnabled("mailto:test@example.com", "", "private") {
		t.Fatal("неполная web push конфигурация не должна считаться включенной")
	}
}
