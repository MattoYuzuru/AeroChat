package rtc

import "errors"

var (
	ErrInvalidArgument  = errors.New("invalid argument")
	ErrUnauthorized     = errors.New("unauthorized")
	ErrNotFound         = errors.New("not found")
	ErrConflict         = errors.New("conflict")
	ErrPermissionDenied = errors.New("permission denied")
)

const (
	ConflictReasonActiveParticipationExists = "active_participation_exists"
)

type ActiveCallConflictError struct {
	Call        Call
	Participant CallParticipant
}

func (e *ActiveCallConflictError) Error() string {
	return "user already has active participation in another call"
}

func (e *ActiveCallConflictError) Unwrap() error {
	return ErrConflict
}

func (e *ActiveCallConflictError) Reason() string {
	return ConflictReasonActiveParticipationExists
}
