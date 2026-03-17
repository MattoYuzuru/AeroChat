package app

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"
)

// Config описывает минимальную runtime-конфигурацию сервиса.
type Config struct {
	HTTPAddress          string
	LogLevel             string
	ShutdownTimeout      time.Duration
	DownstreamTimeout    time.Duration
	RealtimePingInterval time.Duration
	RealtimeWriteTimeout time.Duration
	IdentityBaseURL      string
	ChatBaseURL          string
	CORSAllowedOrigins   []string
}

// LoadConfig загружает конфигурацию из env с безопасными значениями по умолчанию.
func LoadConfig(defaultHTTPAddress string) (Config, error) {
	shutdownTimeout, err := lookupDuration("AERO_SHUTDOWN_TIMEOUT", 10*time.Second)
	if err != nil {
		return Config{}, err
	}
	downstreamTimeout, err := lookupDuration("AERO_DOWNSTREAM_TIMEOUT", 5*time.Second)
	if err != nil {
		return Config{}, err
	}
	realtimePingInterval, err := lookupDuration("AERO_REALTIME_PING_INTERVAL", 30*time.Second)
	if err != nil {
		return Config{}, err
	}
	realtimeWriteTimeout, err := lookupDuration("AERO_REALTIME_WRITE_TIMEOUT", 10*time.Second)
	if err != nil {
		return Config{}, err
	}
	if realtimePingInterval <= 0 {
		return Config{}, fmt.Errorf("переменная %s: требуется положительная длительность", "AERO_REALTIME_PING_INTERVAL")
	}
	if realtimeWriteTimeout <= 0 {
		return Config{}, fmt.Errorf("переменная %s: требуется положительная длительность", "AERO_REALTIME_WRITE_TIMEOUT")
	}
	identityBaseURL, err := lookupURL("AERO_IDENTITY_URL", "http://127.0.0.1:8081")
	if err != nil {
		return Config{}, err
	}
	chatBaseURL, err := lookupURL("AERO_CHAT_URL", "http://127.0.0.1:8082")
	if err != nil {
		return Config{}, err
	}

	return Config{
		HTTPAddress:          lookupString("AERO_HTTP_ADDR", defaultHTTPAddress),
		LogLevel:             lookupString("AERO_LOG_LEVEL", "info"),
		ShutdownTimeout:      shutdownTimeout,
		DownstreamTimeout:    downstreamTimeout,
		RealtimePingInterval: realtimePingInterval,
		RealtimeWriteTimeout: realtimeWriteTimeout,
		IdentityBaseURL:      identityBaseURL,
		ChatBaseURL:          chatBaseURL,
		CORSAllowedOrigins:   lookupCSV("AERO_CORS_ALLOWED_ORIGINS"),
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

func lookupURL(key string, fallback string) (string, error) {
	value := lookupString(key, fallback)

	parsed, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("переменная %s: %w", key, err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("переменная %s: требуется абсолютный url", key)
	}

	return strings.TrimRight(value, "/"), nil
}

func lookupCSV(key string) []string {
	value := os.Getenv(key)
	if value == "" {
		return nil
	}

	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		result = append(result, trimmed)
	}

	return result
}
