package identity

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

// Публичный dummy record не принадлежит аккаунту; результат Verify не авторизует missing login.
// Параметры совпадают с текущим production Argon policy, salt/digest — синтетические байты.
const publicDummyPasswordHash = "$argon2id$v=19$m=65536,t=3,p=2$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

type PasswordHasher interface {
	Hash(string) (string, error)
	Verify(string, string) (bool, error)
}

type PasswordAdmission struct {
	mu      sync.Mutex
	maximum int
	active  map[string]struct{}
}

func NewPasswordAdmission(maximum int) (*PasswordAdmission, error) {
	if maximum < 1 || maximum > 8 {
		return nil, fmt.Errorf("password concurrency must be between 1 and 8")
	}
	return &PasswordAdmission{maximum: maximum, active: make(map[string]struct{})}, nil
}

func (a *PasswordAdmission) acquire(ctx context.Context, login string) (func(), error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if _, exists := a.active[login]; exists || len(a.active) >= a.maximum {
		return nil, ErrResourceExhausted
	}
	a.active[login] = struct{}{}
	var once sync.Once
	return func() { once.Do(func() { a.mu.Lock(); defer a.mu.Unlock(); delete(a.active, login) }) }, nil
}

func (s *Service) hashPassword(ctx context.Context, login, password string) (string, error) {
	release, err := s.passwordAdmission.acquire(ctx, login)
	if err != nil {
		return "", err
	}
	defer release()
	hash, err := s.passwords.Hash(password)
	if canceled := ctx.Err(); canceled != nil {
		return "", canceled
	}
	return hash, err
}

func (s *Service) verifyPasswordCredential(ctx context.Context, login, password string) (*PasswordCredential, error) {
	release, err := s.passwordAdmission.acquire(ctx, login)
	if err != nil {
		return nil, err
	}
	defer release()
	credential, err := s.repo.GetPasswordCredentialByLogin(ctx, login)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	missing := credential == nil || errors.Is(err, ErrNotFound)
	encoded := publicDummyPasswordHash
	if !missing {
		encoded = credential.PasswordHash
	}
	valid, err := s.passwords.Verify(password, encoded)
	if canceled := ctx.Err(); canceled != nil {
		return nil, canceled
	}
	if err != nil {
		return nil, fmt.Errorf("verify password: %w", err)
	}
	if missing || !valid {
		return nil, ErrInvalidCredentials
	}
	return credential, nil
}
