package auth

import "testing"

func TestSessionTokenManagerIssueAndParse(t *testing.T) {
	t.Parallel()

	manager := NewSessionTokenManager()
	token, tokenHash, err := manager.Issue("session-1")
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	parsed, err := manager.Parse(token)
	if err != nil {
		t.Fatalf("parse token: %v", err)
	}

	if parsed.SessionID != "session-1" {
		t.Fatalf("ожидался session id %q, получен %q", "session-1", parsed.SessionID)
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
