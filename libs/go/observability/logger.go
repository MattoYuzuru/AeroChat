package observability

import (
	"fmt"
	"log/slog"
	"os"
	"strings"
)

// NewLogger создаёт JSON-логгер с именем сервиса и уровнем из конфигурации.
func NewLogger(serviceName string, level string) (*slog.Logger, error) {
	parsedLevel, err := parseLevel(level)
	if err != nil {
		return nil, err
	}

	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: parsedLevel,
	})

	return slog.New(handler).With(
		slog.String("service", serviceName),
	), nil
}

func parseLevel(level string) (slog.Level, error) {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "", "info":
		return slog.LevelInfo, nil
	case "debug":
		return slog.LevelDebug, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("неподдерживаемый уровень логирования %q", level)
	}
}
