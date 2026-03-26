package rtc

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"strings"
	"time"
)

type ICEServer struct {
	URLs       []string
	Username   string
	Credential string
	ExpiresAt  *time.Time
}

type ICEServerProvider interface {
	BuildForUser(userID string, now time.Time) []ICEServer
}

type ConfigurableICEServerProvider struct {
	stunURLs        []string
	turnURLs        []string
	turnAuthSecret  string
	turnUsernameTTL time.Duration
}

func NewConfigurableICEServerProvider(
	stunURLs []string,
	turnURLs []string,
	turnAuthSecret string,
	turnUsernameTTL time.Duration,
) *ConfigurableICEServerProvider {
	return &ConfigurableICEServerProvider{
		stunURLs:        normalizeICEServerURLs(stunURLs),
		turnURLs:        normalizeICEServerURLs(turnURLs),
		turnAuthSecret:  strings.TrimSpace(turnAuthSecret),
		turnUsernameTTL: turnUsernameTTL,
	}
}

func (p *ConfigurableICEServerProvider) BuildForUser(userID string, now time.Time) []ICEServer {
	servers := make([]ICEServer, 0, 2)

	if len(p.stunURLs) > 0 {
		servers = append(servers, ICEServer{
			URLs: cloneStringSlice(p.stunURLs),
		})
	}

	if len(p.turnURLs) == 0 || p.turnAuthSecret == "" || userID == "" {
		return servers
	}

	if p.turnUsernameTTL <= 0 {
		p.turnUsernameTTL = 10 * time.Minute
	}

	expiresAt := now.Add(p.turnUsernameTTL).UTC()
	username := fmt.Sprintf("%d:%s", expiresAt.Unix(), userID)

	mac := hmac.New(sha1.New, []byte(p.turnAuthSecret))
	_, _ = mac.Write([]byte(username))

	servers = append(servers, ICEServer{
		URLs:       cloneStringSlice(p.turnURLs),
		Username:   username,
		Credential: base64.StdEncoding.EncodeToString(mac.Sum(nil)),
		ExpiresAt:  &expiresAt,
	})

	return servers
}

func normalizeICEServerURLs(urls []string) []string {
	result := make([]string, 0, len(urls))

	for _, rawURL := range urls {
		normalizedURL := strings.TrimSpace(rawURL)
		if normalizedURL == "" {
			continue
		}

		result = append(result, normalizedURL)
	}

	return result
}

func cloneStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	cloned := make([]string, len(values))
	copy(cloned, values)
	return cloned
}
