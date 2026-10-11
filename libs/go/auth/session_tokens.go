package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
)

const sessionTokenVersion = "v1"

type ParsedSessionToken struct {
	SessionID string
	TokenHash string
}

type SessionTokenManager struct {
	tokenSize int
}

func NewSessionTokenManager() *SessionTokenManager {
	return &SessionTokenManager{tokenSize: 32}
}

func (m *SessionTokenManager) Issue(sessionID string) (string, string, error) {
	if !canonicalSessionID(sessionID) {
		return "", "", fmt.Errorf("invalid session id")
	}
	secret := make([]byte, m.tokenSize)
	if _, err := rand.Read(secret); err != nil {
		return "", "", fmt.Errorf("read session token: %w", err)
	}

	encodedSecret := base64.RawURLEncoding.EncodeToString(secret)
	token := strings.Join([]string{sessionTokenVersion, sessionID, encodedSecret}, ".")
	return token, hashTokenSecret(secret), nil
}

func (m *SessionTokenManager) Parse(token string) (ParsedSessionToken, error) {
	if len(token) != len(sessionTokenVersion)+1+36+1+base64.RawURLEncoding.EncodedLen(m.tokenSize) {
		return ParsedSessionToken{}, fmt.Errorf("invalid session token")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != sessionTokenVersion || !canonicalSessionID(parts[1]) {
		return ParsedSessionToken{}, fmt.Errorf("invalid session token")
	}

	secret, err := base64.RawURLEncoding.Strict().DecodeString(parts[2])
	if err != nil {
		return ParsedSessionToken{}, fmt.Errorf("decode session token: %w", err)
	}
	if len(secret) != m.tokenSize {
		return ParsedSessionToken{}, fmt.Errorf("invalid session token secret length")
	}

	return ParsedSessionToken{
		SessionID: parts[1],
		TokenHash: hashTokenSecret(secret),
	}, nil
}

func canonicalSessionID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for i, char := range value {
		switch i {
		case 8, 13, 18, 23:
			if char != '-' {
				return false
			}
		default:
			if !(char >= '0' && char <= '9' || char >= 'a' && char <= 'f') {
				return false
			}
		}
	}
	return true
}

func hashTokenSecret(secret []byte) string {
	sum := sha256.Sum256(secret)
	return hex.EncodeToString(sum[:])
}
