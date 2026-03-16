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
	secret := make([]byte, m.tokenSize)
	if _, err := rand.Read(secret); err != nil {
		return "", "", fmt.Errorf("read session token: %w", err)
	}

	encodedSecret := base64.RawURLEncoding.EncodeToString(secret)
	token := strings.Join([]string{sessionTokenVersion, sessionID, encodedSecret}, ".")
	return token, hashTokenSecret(secret), nil
}

func (m *SessionTokenManager) Parse(token string) (ParsedSessionToken, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != sessionTokenVersion {
		return ParsedSessionToken{}, fmt.Errorf("invalid session token")
	}

	secret, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return ParsedSessionToken{}, fmt.Errorf("decode session token: %w", err)
	}

	return ParsedSessionToken{
		SessionID: strings.TrimSpace(parts[1]),
		TokenHash: hashTokenSecret(secret),
	}, nil
}

func hashTokenSecret(secret []byte) string {
	sum := sha256.Sum256(secret)
	return hex.EncodeToString(sum[:])
}
