package chat

import "errors"

var (
	ErrInvalidArgument   = errors.New("invalid argument")
	ErrUnauthorized      = errors.New("unauthorized")
	ErrNotFound          = errors.New("not found")
	ErrConflict          = errors.New("conflict")
	ErrPermissionDenied  = errors.New("permission denied")
	ErrResourceExhausted = errors.New("resource exhausted")
)
