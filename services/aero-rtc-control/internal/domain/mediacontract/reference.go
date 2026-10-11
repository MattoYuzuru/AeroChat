// Package mediacontract содержит не подключённую к runtime reference model ADR-097.
// Она не проверяет JWT, mTLS, membership или SFU: эти authoritative результаты
// должны поступать от будущих проверенных adapters. Модель не является auth handler.
package mediacontract

import (
	"errors"
	"math"
	"strings"
	"time"
)

var (
	ErrDenied               = errors.New("media admission denied")
	ErrAuthorityUnavailable = errors.New("media authority unavailable")
	ErrTeardownPending      = errors.New("media teardown pending")
)

type State string

const (
	Prepared State = "prepared"
	Active   State = "active"
	Revoking State = "revoking"
	Revoked  State = "revoked"
)

type Key struct {
	Room                string
	ParticipantIdentity string
	Generation          uint64
}

type Binding struct {
	Key              Key
	GrantID          string
	CallID           string
	ParticipantID    string
	GroupID          string
	UserID           string
	SessionID        string
	DeviceID         string
	EligibilityEpoch int64
}

type VerifiedToken struct {
	Key                 Key
	SignatureVerified   bool
	PermissionsVerified bool
	ExpiresAt           time.Time
}

type AuthorityObservation struct {
	Available         bool
	Fresh             bool
	UserID            string
	SessionID         string
	DeviceID          string
	GroupID           string
	SessionActive     bool
	DeviceActive      bool
	ParticipantActive bool
	GroupRole         string
	EligibilityEpoch  int64
}

type TeardownAcknowledgement struct {
	Key                          Key
	AdmissionConnectionsClosed   bool
	RequiredSFUTeardownConfirmed bool
}

type ReferenceModel struct {
	binding Binding
	state   State
}

func NewReferenceModel(binding Binding) (*ReferenceModel, error) {
	if binding.Key.Generation == 0 || binding.EligibilityEpoch <= 0 || binding.EligibilityEpoch >= math.MaxInt64 {
		return nil, ErrDenied
	}
	for _, value := range []string{
		binding.Key.Room, binding.Key.ParticipantIdentity, binding.GrantID,
		binding.CallID, binding.ParticipantID, binding.GroupID, binding.UserID,
		binding.SessionID, binding.DeviceID,
	} {
		if strings.TrimSpace(value) == "" {
			return nil, ErrDenied
		}
	}
	return &ReferenceModel{binding: binding, state: Prepared}, nil
}

func (m *ReferenceModel) State() State { return m.state }

func (m *ReferenceModel) Activate() error {
	if m.state != Prepared && m.state != Active {
		return ErrDenied
	}
	m.state = Active
	return nil
}

func (m *ReferenceModel) CheckAdmission(token VerifiedToken, authority AuthorityObservation, now time.Time) error {
	if m.state != Active || token.Key != m.binding.Key ||
		!token.SignatureVerified || !token.PermissionsVerified ||
		!token.ExpiresAt.After(now) {
		return ErrDenied
	}
	if !authority.Available || !authority.Fresh {
		return ErrAuthorityUnavailable
	}
	if authority.UserID != m.binding.UserID || authority.SessionID != m.binding.SessionID ||
		authority.DeviceID != m.binding.DeviceID || authority.GroupID != m.binding.GroupID ||
		authority.EligibilityEpoch != m.binding.EligibilityEpoch ||
		!authority.SessionActive || !authority.DeviceActive || !authority.ParticipantActive {
		return ErrDenied
	}
	switch authority.GroupRole {
	case "owner", "admin", "member":
		return nil
	default:
		return ErrDenied
	}
}

func (m *ReferenceModel) BeginRevoke() error {
	if m.state == Revoking || m.state == Revoked {
		return nil
	}
	if m.state != Prepared && m.state != Active {
		return ErrDenied
	}
	m.state = Revoking
	return nil
}

func (m *ReferenceModel) ConfirmTeardown(ack TeardownAcknowledgement) error {
	if ack.Key != m.binding.Key {
		return ErrDenied
	}
	if m.state == Revoked {
		return nil
	}
	if m.state != Revoking {
		return ErrDenied
	}
	if !ack.AdmissionConnectionsClosed || !ack.RequiredSFUTeardownConfirmed {
		return ErrTeardownPending
	}
	m.state = Revoked
	return nil
}
