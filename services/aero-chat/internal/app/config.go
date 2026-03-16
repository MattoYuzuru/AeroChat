package app

import (
	"fmt"
	"os"
	"time"
)

// Config описывает минимальную runtime-конфигурацию сервиса.
type Config struct {
	DatabaseURL           string
	RedisAddress          string
	HTTPAddress           string
	LogLevel              string
	ShutdownTimeout       time.Duration
	DirectChatTypingTTL   time.Duration
	DirectChatPresenceTTL time.Duration
}

// LoadConfig загружает конфигурацию из env с безопасными значениями по умолчанию.
func LoadConfig(defaultHTTPAddress string) (Config, error) {
	shutdownTimeout, err := lookupDuration("AERO_SHUTDOWN_TIMEOUT", 10*time.Second)
	if err != nil {
		return Config{}, err
	}
	typingTTL, err := lookupDuration("AERO_DIRECT_CHAT_TYPING_TTL", 6*time.Second)
	if err != nil {
		return Config{}, err
	}
	presenceTTL, err := lookupDuration("AERO_DIRECT_CHAT_PRESENCE_TTL", 30*time.Second)
	if err != nil {
		return Config{}, err
	}

	return Config{
		DatabaseURL:           lookupString("AERO_DATABASE_URL", "postgres://aerochat:aerochat@localhost:5432/aerochat?sslmode=disable"),
		RedisAddress:          lookupString("AERO_REDIS_ADDR", "localhost:6379"),
		HTTPAddress:           lookupString("AERO_HTTP_ADDR", defaultHTTPAddress),
		LogLevel:              lookupString("AERO_LOG_LEVEL", "info"),
		ShutdownTimeout:       shutdownTimeout,
		DirectChatTypingTTL:   typingTTL,
		DirectChatPresenceTTL: presenceTTL,
	}, nil
}

func lookupString(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	return value
}

func lookupDuration(key string, fallback time.Duration) (time.Duration, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}

	parsed, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("переменная %s: %w", key, err)
	}

	return parsed, nil
}
