package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	argonVariant = "argon2id"
	argonVersion = 0x13
	saltSize     = 16
	keySize      = 32
)

type PasswordHasher struct {
	timeCost    uint32
	memoryCost  uint32
	parallelism uint8
}

func NewPasswordHasher() *PasswordHasher {
	return &PasswordHasher{
		timeCost:    3,
		memoryCost:  64 * 1024,
		parallelism: 2,
	}
}

func (h *PasswordHasher) Hash(password string) (string, error) {
	salt := make([]byte, saltSize)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("read salt: %w", err)
	}

	key := argon2.IDKey([]byte(password), salt, h.timeCost, h.memoryCost, h.parallelism, keySize)

	return fmt.Sprintf(
		"$%s$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argonVariant,
		argonVersion,
		h.memoryCost,
		h.timeCost,
		h.parallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

func (h *PasswordHasher) Verify(password string, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != argonVariant {
		return false, fmt.Errorf("unsupported password hash format")
	}

	var version int
	var memory uint32
	var timeCost uint32
	var parallelism uint8
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return false, fmt.Errorf("parse password hash version: %w", err)
	}
	if version != argonVersion {
		return false, fmt.Errorf("unsupported password hash version")
	}
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &timeCost, &parallelism); err != nil {
		return false, fmt.Errorf("parse password hash params: %w", err)
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, fmt.Errorf("decode password salt: %w", err)
	}
	expectedKey, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, fmt.Errorf("decode password hash: %w", err)
	}

	actualKey := argon2.IDKey([]byte(password), salt, timeCost, memory, parallelism, uint32(len(expectedKey)))
	if subtle.ConstantTimeCompare(actualKey, expectedKey) != 1 {
		return false, nil
	}

	return true, nil
}
