package identity

import "errors"

var (
	ErrInvalidArgument    = errors.New("invalid argument")
	ErrLoginTaken         = errors.New("login already taken")
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrUnauthorized       = errors.New("unauthorized")
	ErrNotFound           = errors.New("not found")
	ErrConflict           = errors.New("conflict")
)
