package app

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config описывает минимальную runtime-конфигурацию сервиса.
type Config struct {
	DatabaseURL               string
	HTTPAddress               string
	LogLevel                  string
	ShutdownTimeout           time.Duration
	DatabaseBootstrapTimeout  time.Duration
	DownstreamTimeout         time.Duration
	IdentityBaseURL           string
	ChatBaseURL               string
	STUNServerURLs            []string
	TURNServerURLs            []string
	TURNAuthSecret            string
	TURNUsernameTTL           time.Duration
	MaxSignalPayloadSizeBytes int
}

// LoadConfig загружает конфигурацию из env с безопасными значениями по умолчанию.
func LoadConfig(defaultHTTPAddress string) (Config, error) {
	shutdownTimeout, err := lookupDuration("AERO_SHUTDOWN_TIMEOUT", 10*time.Second)
	if err != nil {
		return Config{}, err
	}
	bootstrapTimeout, err := lookupDuration("AERO_DATABASE_BOOTSTRAP_TIMEOUT", 30*time.Second)
	if err != nil {
		return Config{}, err
	}
	downstreamTimeout, err := lookupDuration("AERO_DOWNSTREAM_TIMEOUT", 5*time.Second)
	if err != nil {
		return Config{}, err
	}
	turnUsernameTTL, err := lookupDuration("AERO_RTC_TURN_USERNAME_TTL", 10*time.Minute)
	if err != nil {
		return Config{}, err
	}
	identityBaseURL, err := lookupURL("AERO_IDENTITY_URL", "http://127.0.0.1:8081")
	if err != nil {
		return Config{}, err
	}
	chatBaseURL, err := lookupURL("AERO_CHAT_URL", "http://127.0.0.1:8082")
	if err != nil {
		return Config{}, err
	}
	maxSignalPayloadSizeBytes, err := lookupInt("AERO_RTC_SIGNAL_MAX_PAYLOAD_BYTES", 16*1024)
	if err != nil {
		return Config{}, err
	}
	if maxSignalPayloadSizeBytes <= 0 {
		return Config{}, fmt.Errorf("переменная %s должна быть положительной", "AERO_RTC_SIGNAL_MAX_PAYLOAD_BYTES")
	}

	return Config{
		DatabaseURL:               lookupString("AERO_DATABASE_URL", "postgres://aerochat:aerochat@localhost:5432/aerochat?sslmode=disable"),
		HTTPAddress:               lookupString("AERO_HTTP_ADDR", defaultHTTPAddress),
		LogLevel:                  lookupString("AERO_LOG_LEVEL", "info"),
		ShutdownTimeout:           shutdownTimeout,
		DatabaseBootstrapTimeout:  bootstrapTimeout,
		DownstreamTimeout:         downstreamTimeout,
		IdentityBaseURL:           identityBaseURL,
		ChatBaseURL:               chatBaseURL,
		STUNServerURLs:            lookupStringList("AERO_RTC_STUN_URLS", []string{"stun:stun.cloudflare.com:3478"}),
		TURNServerURLs:            lookupStringList("AERO_RTC_TURN_URLS", nil),
		TURNAuthSecret:            lookupString("AERO_RTC_TURN_AUTH_SECRET", ""),
		TURNUsernameTTL:           turnUsernameTTL,
		MaxSignalPayloadSizeBytes: maxSignalPayloadSizeBytes,
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

func lookupInt(key string, fallback int) (int, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}

	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("переменная %s: %w", key, err)
	}

	return parsed, nil
}

func lookupStringList(key string, fallback []string) []string {
	value := os.Getenv(key)
	if value == "" {
		return append([]string(nil), fallback...)
	}

	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == '\n'
	})
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		normalized := strings.TrimSpace(part)
		if normalized == "" {
			continue
		}

		result = append(result, normalized)
	}
	if len(result) == 0 {
		return append([]string(nil), fallback...)
	}

	return result
}
