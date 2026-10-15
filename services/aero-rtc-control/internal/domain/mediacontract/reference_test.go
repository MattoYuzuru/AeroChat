package mediacontract

import (
	"errors"
	"testing"
	"time"
)

func fixture(t *testing.T) (*ReferenceModel, VerifiedToken, AuthorityObservation, time.Time) {
	t.Helper()
	key := Key{Room: "server-call-generation", ParticipantIdentity: "opaque-server-identity", Generation: 3}
	model, err := NewReferenceModel(Binding{
		Key: key, GrantID: "grant", CallID: "call", ParticipantID: "participant",
		GroupID: "group", UserID: "user", SessionID: "session", DeviceID: "device",
	})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 11, 0, 0, 0, 0, time.UTC)
	token := VerifiedToken{Key: key, SignatureVerified: true, PermissionsVerified: true, ExpiresAt: now.Add(time.Minute)}
	authority := AuthorityObservation{
		Available: true, Fresh: true, UserID: "user", SessionID: "session", DeviceID: "device", GroupID: "group",
		SessionActive: true, DeviceActive: true, ParticipantActive: true, GroupRole: "member",
	}
	return model, token, authority, now
}

func TestReferenceAdmissionRequiresAuthoritativeBinding(t *testing.T) {
	t.Parallel()
	model, token, authority, now := fixture(t)
	if err := model.CheckAdmission(token, authority, now); !errors.Is(err, ErrDenied) {
		t.Fatal("prepared reservation must not admit")
	}
	if err := model.Activate(); err != nil {
		t.Fatal(err)
	}
	if err := model.CheckAdmission(token, authority, now); err != nil {
		t.Fatal(err)
	}
	for _, role := range []string{"owner", "admin", "member"} {
		current := authority
		current.GroupRole = role
		if err := model.CheckAdmission(token, current, now); err != nil {
			t.Fatal("eligible role denied")
		}
	}
	for name, change := range map[string]func(*VerifiedToken, *AuthorityObservation){
		"wrong room":         func(token *VerifiedToken, _ *AuthorityObservation) { token.Key.Room = "foreign" },
		"old generation":     func(token *VerifiedToken, _ *AuthorityObservation) { token.Key.Generation-- },
		"foreign identity":   func(token *VerifiedToken, _ *AuthorityObservation) { token.Key.ParticipantIdentity = "foreign" },
		"unverified JWT":     func(token *VerifiedToken, _ *AuthorityObservation) { token.SignatureVerified = false },
		"unsafe permissions": func(token *VerifiedToken, _ *AuthorityObservation) { token.PermissionsVerified = false },
		"expired JWT":        func(token *VerifiedToken, _ *AuthorityObservation) { token.ExpiresAt = now },
		"wrong session":      func(_ *VerifiedToken, authority *AuthorityObservation) { authority.SessionID = "foreign" },
		"wrong device":       func(_ *VerifiedToken, authority *AuthorityObservation) { authority.DeviceID = "foreign" },
		"wrong user":         func(_ *VerifiedToken, authority *AuthorityObservation) { authority.UserID = "foreign" },
		"wrong group":        func(_ *VerifiedToken, authority *AuthorityObservation) { authority.GroupID = "foreign" },
		"revoked session":    func(_ *VerifiedToken, authority *AuthorityObservation) { authority.SessionActive = false },
		"revoked device":     func(_ *VerifiedToken, authority *AuthorityObservation) { authority.DeviceActive = false },
		"left participant":   func(_ *VerifiedToken, authority *AuthorityObservation) { authority.ParticipantActive = false },
		"reader":             func(_ *VerifiedToken, authority *AuthorityObservation) { authority.GroupRole = "reader" },
		"removed member":     func(_ *VerifiedToken, authority *AuthorityObservation) { authority.GroupRole = "" },
		"unknown role":       func(_ *VerifiedToken, authority *AuthorityObservation) { authority.GroupRole = "unknown" },
	} {
		t.Run(name, func(t *testing.T) {
			changedToken, changedAuthority := token, authority
			change(&changedToken, &changedAuthority)
			if err := model.CheckAdmission(changedToken, changedAuthority, now); !errors.Is(err, ErrDenied) {
				t.Fatal("invalid admission accepted")
			}
		})
	}
}

func TestReferenceAuthorityFailureDeniesWithoutPermanentRevoke(t *testing.T) {
	t.Parallel()
	model, token, authority, now := fixture(t)
	if err := model.Activate(); err != nil {
		t.Fatal(err)
	}
	for _, current := range []AuthorityObservation{
		{}, {Available: false, Fresh: true}, {Available: true, Fresh: false},
	} {
		if err := model.CheckAdmission(token, current, now); !errors.Is(err, ErrAuthorityUnavailable) {
			t.Fatal("missing fresh authority must fail closed")
		}
		if model.State() != Active {
			t.Fatal("transient authority failure falsely revoked grant")
		}
	}
	if err := model.CheckAdmission(token, authority, now); err != nil {
		t.Fatal("fresh recovered authority denied")
	}
}

func TestReferenceRevokeRejectsRefreshedTokenAndRequiresCurrentTeardown(t *testing.T) {
	t.Parallel()
	model, initial, authority, now := fixture(t)
	if err := model.Activate(); err != nil {
		t.Fatal(err)
	}
	refreshed := initial
	refreshed.ExpiresAt = now.Add(10 * time.Minute)
	if err := model.CheckAdmission(refreshed, authority, now); err != nil {
		t.Fatal("refresh with same stable key should use existing active grant")
	}
	if err := model.BeginRevoke(); err != nil {
		t.Fatal(err)
	}
	for _, token := range []VerifiedToken{initial, refreshed} {
		if err := model.CheckAdmission(token, authority, now); !errors.Is(err, ErrDenied) {
			t.Fatal("replay/refreshed token reactivated revoking grant")
		}
	}
	for _, ack := range []TeardownAcknowledgement{
		{Key: initial.Key},
		{Key: initial.Key, AdmissionConnectionsClosed: true},
		{Key: initial.Key, RequiredSFUTeardownConfirmed: true},
	} {
		if err := model.ConfirmTeardown(ack); !errors.Is(err, ErrTeardownPending) || model.State() != Revoking {
			t.Fatal("partial/failed cleanup must stay pending with slot retained")
		}
	}
	wrong := initial.Key
	wrong.Generation--
	if err := model.ConfirmTeardown(TeardownAcknowledgement{Key: wrong, AdmissionConnectionsClosed: true, RequiredSFUTeardownConfirmed: true}); !errors.Is(err, ErrDenied) {
		t.Fatal("old generation acknowledgement finalized current grant")
	}
	if err := model.Activate(); !errors.Is(err, ErrDenied) {
		t.Fatal("revoking grant must not reactivate")
	}
	ack := TeardownAcknowledgement{Key: initial.Key, AdmissionConnectionsClosed: true, RequiredSFUTeardownConfirmed: true}
	if err := model.ConfirmTeardown(ack); err != nil || model.State() != Revoked {
		t.Fatal("confirmed teardown must finish revoke")
	}
	if err := model.ConfirmTeardown(ack); err != nil {
		t.Fatal("same acknowledgement retry must be idempotent")
	}
	if err := model.BeginRevoke(); err != nil || model.State() != Revoked {
		t.Fatal("repeated revoke must preserve terminal state")
	}
	if err := model.CheckAdmission(refreshed, authority, now); !errors.Is(err, ErrDenied) {
		t.Fatal("refreshed token admitted after terminal revoke")
	}
}

func TestReferenceDefaultStateAndMalformedBindingDeny(t *testing.T) {
	t.Parallel()
	var zero ReferenceModel
	_, token, authority, now := fixture(t)
	if err := zero.Activate(); !errors.Is(err, ErrDenied) {
		t.Fatal("zero model activated")
	}
	if err := zero.BeginRevoke(); !errors.Is(err, ErrDenied) {
		t.Fatal("zero model revoked as a known grant")
	}
	if err := zero.ConfirmTeardown(TeardownAcknowledgement{}); !errors.Is(err, ErrDenied) {
		t.Fatal("zero model accepted teardown")
	}
	if err := zero.CheckAdmission(token, authority, now); !errors.Is(err, ErrDenied) {
		t.Fatal("zero model admitted")
	}
	if _, err := NewReferenceModel(Binding{}); !errors.Is(err, ErrDenied) {
		t.Fatal("empty binding accepted")
	}
	model, _, _, _ := fixture(t)
	invalid := model.binding
	invalid.SessionID = " "
	if _, err := NewReferenceModel(invalid); !errors.Is(err, ErrDenied) {
		t.Fatal("missing session binding accepted")
	}
	if err := model.ConfirmTeardown(TeardownAcknowledgement{Key: model.binding.Key, AdmissionConnectionsClosed: true, RequiredSFUTeardownConfirmed: true}); !errors.Is(err, ErrDenied) {
		t.Fatal("prepared state bypassed revoke ordering")
	}
}
