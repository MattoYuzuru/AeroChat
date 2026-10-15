package auth

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestSessionTokenManagerIssueAndParse(t *testing.T) {
	t.Parallel()

	manager := NewSessionTokenManager()
	const sessionID = "00000000-0000-0000-0000-000000000001"
	token, tokenHash, err := manager.Issue(sessionID)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	parsed, err := manager.Parse(token)
	if err != nil {
		t.Fatalf("parse token: %v", err)
	}

	if parsed.SessionID != sessionID {
		t.Fatalf("ожидался session id %q, получен %q", sessionID, parsed.SessionID)
	}
	if parsed.TokenHash != tokenHash {
		t.Fatal("ожидался тот же token hash после парсинга")
	}
}

func TestSessionTokenManagerRejectsInvalidToken(t *testing.T) {
	t.Parallel()

	manager := NewSessionTokenManager()
	if _, err := manager.Parse("bad-token"); err == nil {
		t.Fatal("ожидалась ошибка для невалидного session token")
	}
}

func TestSessionTokenManagerRejectsMalformedFields(t *testing.T) {
	manager := NewSessionTokenManager()
	id := "00000000-0000-0000-0000-000000000001"
	secret := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	cases := map[string]string{
		"version":              "v2." + id + "." + secret,
		"non-uuid":             "v1.not-a-uuid." + secret,
		"empty-id":             "v1.." + secret,
		"id-whitespace":        "v1. " + id + "." + secret,
		"uppercase-id":         "v1.AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA." + secret,
		"compact-id":           "v1." + strings.ReplaceAll(id, "-", "") + "." + secret,
		"empty-secret":         "v1." + id + ".",
		"short-secret":         "v1." + id + ".YQ",
		"long-secret":          "v1." + id + "." + base64.RawURLEncoding.EncodeToString(make([]byte, 33)),
		"base64":               "v1." + id + "." + strings.Repeat("!", 43),
		"base64-padding":       "v1." + id + "." + secret + "=",
		"base64-trailing-bits": "v1." + id + "." + secret[:42] + "B",
	}
	for name, token := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := manager.Parse(token); err == nil {
				t.Fatal("malformed session credential must be rejected")
			}
		})
	}
}
