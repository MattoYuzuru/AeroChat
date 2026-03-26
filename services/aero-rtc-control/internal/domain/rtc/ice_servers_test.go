package rtc

import (
	"testing"
	"time"
)

func TestConfigurableICEServerProviderBuildForUserReturnsStunAndTurnServers(t *testing.T) {
	provider := NewConfigurableICEServerProvider(
		[]string{"stun:stun.cloudflare.com:3478"},
		[]string{"turn:turn.example.com:3478?transport=udp"},
		"super-secret",
		10*time.Minute,
	)

	now := time.Date(2026, time.March, 26, 12, 0, 0, 0, time.UTC)
	servers := provider.BuildForUser("user-1", now)
	if len(servers) != 2 {
		t.Fatalf("ожидались stun и turn servers, получено %d", len(servers))
	}

	if len(servers[0].URLs) != 1 || servers[0].URLs[0] != "stun:stun.cloudflare.com:3478" {
		t.Fatalf("неожиданный stun server: %#v", servers[0])
	}

	turnServer := servers[1]
	if len(turnServer.URLs) != 1 || turnServer.URLs[0] != "turn:turn.example.com:3478?transport=udp" {
		t.Fatalf("неожиданный turn server: %#v", turnServer)
	}
	if turnServer.Username != "1774527000:user-1" {
		t.Fatalf("неожиданный turn username: %q", turnServer.Username)
	}
	if turnServer.Credential == "" {
		t.Fatal("ожидался turn credential")
	}
	if turnServer.ExpiresAt == nil || !turnServer.ExpiresAt.Equal(now.Add(10*time.Minute)) {
		t.Fatalf("неожиданный expiresAt: %#v", turnServer.ExpiresAt)
	}
}

func TestConfigurableICEServerProviderOmitsTurnWithoutSecret(t *testing.T) {
	provider := NewConfigurableICEServerProvider(
		[]string{"stun:stun.cloudflare.com:3478"},
		[]string{"turn:turn.example.com:3478?transport=udp"},
		"",
		10*time.Minute,
	)

	servers := provider.BuildForUser("user-1", time.Now().UTC())
	if len(servers) != 1 {
		t.Fatalf("ожидался только stun server, получено %d", len(servers))
	}
	if servers[0].Username != "" || servers[0].Credential != "" {
		t.Fatalf("stun server не должен содержать credentials: %#v", servers[0])
	}
}
