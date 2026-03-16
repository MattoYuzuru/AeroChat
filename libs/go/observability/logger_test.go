package observability

import "testing"

func TestNewLoggerRejectsUnknownLevel(t *testing.T) {
	t.Parallel()

	if _, err := NewLogger("test-service", "trace"); err == nil {
		t.Fatal("ожидалась ошибка для неподдерживаемого уровня логирования")
	}
}
