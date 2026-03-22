package identity

import (
	"context"
	"fmt"
	"strings"
	"time"
)

const (
	maxCryptoSuiteLen      = 64
	maxSignedPrekeyIDLen   = 128
	maxRevocationReasonLen = 500
)

func (s *Service) RegisterFirstCryptoDevice(ctx context.Context, token string, input RegisterCryptoDeviceInput) (*CryptoDeviceDetails, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	deviceLabel, err := normalizeDeviceLabel(input.DeviceLabel)
	if err != nil {
		return nil, err
	}

	now := s.now()
	bundle, err := normalizeCryptoDeviceBundleInput(input.Bundle, now)
	if err != nil {
		return nil, err
	}

	totalCount, activeCount, _, err := s.repo.GetCryptoDeviceRegistryStatsByUserID(ctx, authSession.User.ID)
	if err != nil {
		return nil, err
	}
	if totalCount > 0 || activeCount > 0 {
		return nil, fmt.Errorf("%w: first crypto device already exists or registry state is not empty", ErrConflict)
	}

	lastBundleVersion := int64(1)
	lastBundlePublishedAt := now
	activatedAt := now
	device, currentBundle, err := s.repo.CreateCryptoDevice(ctx, CreateCryptoDeviceParams{
		Device: CryptoDevice{
			ID:                    s.newID(),
			UserID:                authSession.User.ID,
			Label:                 deviceLabel,
			Status:                CryptoDeviceStatusActive,
			LastBundleVersion:     &lastBundleVersion,
			LastBundlePublishedAt: &lastBundlePublishedAt,
			CreatedAt:             now,
			ActivatedAt:           &activatedAt,
		},
		Bundle: CryptoDeviceBundle{
			CryptoDeviceID:          "",
			BundleVersion:           lastBundleVersion,
			CryptoSuite:             bundle.CryptoSuite,
			IdentityPublicKey:       bundle.IdentityPublicKey,
			SignedPrekeyPublic:      bundle.SignedPrekeyPublic,
			SignedPrekeyID:          bundle.SignedPrekeyID,
			SignedPrekeySignature:   bundle.SignedPrekeySignature,
			KEMPublicKey:            bundle.KEMPublicKey,
			KEMKeyID:                bundle.KEMKeyID,
			KEMSignature:            bundle.KEMSignature,
			OneTimePrekeysTotal:     bundle.OneTimePrekeysTotal,
			OneTimePrekeysAvailable: bundle.OneTimePrekeysAvailable,
			BundleDigest:            bundle.BundleDigest,
			PublishedAt:             now,
			ExpiresAt:               bundle.ExpiresAt,
		},
	})
	if err != nil {
		return nil, err
	}

	return &CryptoDeviceDetails{
		Device:        *device,
		CurrentBundle: currentBundle,
	}, nil
}

func (s *Service) RegisterPendingLinkedCryptoDevice(ctx context.Context, token string, input RegisterCryptoDeviceInput) (*CryptoDeviceDetails, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	deviceLabel, err := normalizeDeviceLabel(input.DeviceLabel)
	if err != nil {
		return nil, err
	}

	now := s.now()
	bundle, err := normalizeCryptoDeviceBundleInput(input.Bundle, now)
	if err != nil {
		return nil, err
	}

	totalCount, activeCount, _, err := s.repo.GetCryptoDeviceRegistryStatsByUserID(ctx, authSession.User.ID)
	if err != nil {
		return nil, err
	}
	if totalCount == 0 || activeCount == 0 {
		return nil, fmt.Errorf("%w: pending linked device requires an existing active crypto device", ErrConflict)
	}

	lastBundleVersion := int64(1)
	lastBundlePublishedAt := now
	device, currentBundle, err := s.repo.CreateCryptoDevice(ctx, CreateCryptoDeviceParams{
		Device: CryptoDevice{
			ID:                    s.newID(),
			UserID:                authSession.User.ID,
			Label:                 deviceLabel,
			Status:                CryptoDeviceStatusPendingLink,
			LastBundleVersion:     &lastBundleVersion,
			LastBundlePublishedAt: &lastBundlePublishedAt,
			CreatedAt:             now,
		},
		Bundle: CryptoDeviceBundle{
			CryptoDeviceID:          "",
			BundleVersion:           lastBundleVersion,
			CryptoSuite:             bundle.CryptoSuite,
			IdentityPublicKey:       bundle.IdentityPublicKey,
			SignedPrekeyPublic:      bundle.SignedPrekeyPublic,
			SignedPrekeyID:          bundle.SignedPrekeyID,
			SignedPrekeySignature:   bundle.SignedPrekeySignature,
			KEMPublicKey:            bundle.KEMPublicKey,
			KEMKeyID:                bundle.KEMKeyID,
			KEMSignature:            bundle.KEMSignature,
			OneTimePrekeysTotal:     bundle.OneTimePrekeysTotal,
			OneTimePrekeysAvailable: bundle.OneTimePrekeysAvailable,
			BundleDigest:            bundle.BundleDigest,
			PublishedAt:             now,
			ExpiresAt:               bundle.ExpiresAt,
		},
	})
	if err != nil {
		return nil, err
	}

	return &CryptoDeviceDetails{
		Device:        *device,
		CurrentBundle: currentBundle,
	}, nil
}

func (s *Service) ListCryptoDevices(ctx context.Context, token string) ([]CryptoDevice, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	return s.repo.ListCryptoDevices(ctx, authSession.User.ID)
}

func (s *Service) GetCryptoDevice(ctx context.Context, token string, cryptoDeviceID string) (*CryptoDeviceDetails, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	deviceID, err := normalizeRequiredID(cryptoDeviceID, "crypto_device_id")
	if err != nil {
		return nil, err
	}

	return s.repo.GetCryptoDeviceDetails(ctx, authSession.User.ID, deviceID)
}

func (s *Service) PublishCryptoDeviceBundle(ctx context.Context, token string, input PublishCryptoDeviceBundleInput) (*CryptoDeviceDetails, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	deviceID, err := normalizeRequiredID(input.CryptoDeviceID, "crypto_device_id")
	if err != nil {
		return nil, err
	}

	bundle, err := normalizeCryptoDeviceBundleInput(input.Bundle, s.now())
	if err != nil {
		return nil, err
	}

	device, currentBundle, err := s.repo.PublishCryptoDeviceBundle(ctx, authSession.User.ID, PublishCryptoDeviceBundleInput{
		CryptoDeviceID: deviceID,
		Bundle:         bundle,
	}, s.now())
	if err != nil {
		return nil, err
	}

	return &CryptoDeviceDetails{
		Device:        *device,
		CurrentBundle: currentBundle,
	}, nil
}

func (s *Service) CreateCryptoDeviceLinkIntent(ctx context.Context, token string, pendingCryptoDeviceID string) (*CryptoDeviceLinkIntent, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	deviceID, err := normalizeRequiredID(pendingCryptoDeviceID, "pending_crypto_device_id")
	if err != nil {
		return nil, err
	}

	details, err := s.repo.GetCryptoDeviceDetails(ctx, authSession.User.ID, deviceID)
	if err != nil {
		return nil, err
	}
	if details.Device.Status != CryptoDeviceStatusPendingLink {
		return nil, fmt.Errorf("%w: link intent can be created only for pending devices", ErrConflict)
	}
	if details.CurrentBundle == nil {
		return nil, fmt.Errorf("%w: pending crypto device has no current bundle", ErrConflict)
	}

	now := s.now()
	return s.repo.CreateCryptoDeviceLinkIntent(ctx, CreateCryptoDeviceLinkIntentParams{
		LinkIntent: CryptoDeviceLinkIntent{
			ID:                    s.newID(),
			UserID:                authSession.User.ID,
			PendingCryptoDeviceID: details.Device.ID,
			Status:                CryptoDeviceLinkIntentStatusPending,
			BundleDigest:          cloneBytes(details.CurrentBundle.BundleDigest),
			CreatedAt:             now,
			ExpiresAt:             now.Add(s.cryptoLinkIntentTTL),
		},
	})
}

func (s *Service) ListCryptoDeviceLinkIntents(ctx context.Context, token string) ([]CryptoDeviceLinkIntent, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	return s.repo.ListCryptoDeviceLinkIntents(ctx, authSession.User.ID, s.now())
}

func (s *Service) ApproveCryptoDeviceLinkIntent(ctx context.Context, token string, linkIntentID string, approverCryptoDeviceID string) (*CryptoDeviceLinkIntent, *CryptoDevice, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, nil, err
	}

	intentID, err := normalizeRequiredID(linkIntentID, "link_intent_id")
	if err != nil {
		return nil, nil, err
	}

	approverID, err := normalizeRequiredID(approverCryptoDeviceID, "approver_crypto_device_id")
	if err != nil {
		return nil, nil, err
	}

	return s.repo.ApproveCryptoDeviceLinkIntent(ctx, ApproveCryptoDeviceLinkIntentParams{
		UserID:                 authSession.User.ID,
		LinkIntentID:           intentID,
		ApproverCryptoDeviceID: approverID,
		ApprovedAt:             s.now(),
	})
}

func (s *Service) ExpireCryptoDeviceLinkIntent(ctx context.Context, token string, linkIntentID string) (*CryptoDeviceLinkIntent, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	intentID, err := normalizeRequiredID(linkIntentID, "link_intent_id")
	if err != nil {
		return nil, err
	}

	return s.repo.ExpireCryptoDeviceLinkIntent(ctx, authSession.User.ID, intentID, s.now())
}

func (s *Service) RevokeCryptoDevice(ctx context.Context, token string, cryptoDeviceID string, revocationReason *string) (*CryptoDevice, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	deviceID, err := normalizeRequiredID(cryptoDeviceID, "crypto_device_id")
	if err != nil {
		return nil, err
	}

	reason, err := normalizeOptionalString(valueOrEmpty(revocationReason), maxRevocationReasonLen)
	if err != nil {
		return nil, fmt.Errorf("%w: revocation_reason: %v", ErrInvalidArgument, err)
	}

	return s.repo.RevokeCryptoDevice(ctx, RevokeCryptoDeviceParams{
		UserID:           authSession.User.ID,
		CryptoDeviceID:   deviceID,
		RevokedAt:        s.now(),
		RevocationReason: reason,
		RevokedByActor:   CryptoDeviceRevokedBySelf,
	})
}

func normalizeCryptoDeviceBundleInput(input CryptoDeviceBundleInput, now time.Time) (CryptoDeviceBundleInput, error) {
	cryptoSuite := strings.TrimSpace(input.CryptoSuite)
	if cryptoSuite == "" || len([]rune(cryptoSuite)) > maxCryptoSuiteLen {
		return CryptoDeviceBundleInput{}, fmt.Errorf("%w: crypto_suite must be between 1 and 64 characters", ErrInvalidArgument)
	}

	signedPrekeyID := strings.TrimSpace(input.SignedPrekeyID)
	if signedPrekeyID == "" || len([]rune(signedPrekeyID)) > maxSignedPrekeyIDLen {
		return CryptoDeviceBundleInput{}, fmt.Errorf("%w: signed_prekey_id must be between 1 and 128 characters", ErrInvalidArgument)
	}

	if len(input.IdentityPublicKey) == 0 {
		return CryptoDeviceBundleInput{}, fmt.Errorf("%w: identity_public_key is required", ErrInvalidArgument)
	}
	if len(input.SignedPrekeyPublic) == 0 {
		return CryptoDeviceBundleInput{}, fmt.Errorf("%w: signed_prekey_public is required", ErrInvalidArgument)
	}
	if len(input.SignedPrekeySignature) == 0 {
		return CryptoDeviceBundleInput{}, fmt.Errorf("%w: signed_prekey_signature is required", ErrInvalidArgument)
	}
	if len(input.BundleDigest) == 0 {
		return CryptoDeviceBundleInput{}, fmt.Errorf("%w: bundle_digest is required", ErrInvalidArgument)
	}
	if input.OneTimePrekeysTotal < 0 || input.OneTimePrekeysAvailable < 0 || input.OneTimePrekeysAvailable > input.OneTimePrekeysTotal {
		return CryptoDeviceBundleInput{}, fmt.Errorf("%w: one-time prekey inventory is invalid", ErrInvalidArgument)
	}

	kemPublicPresent := len(input.KEMPublicKey) > 0
	kemSignaturePresent := len(input.KEMSignature) > 0
	kemKeyIDPresent := input.KEMKeyID != nil && strings.TrimSpace(*input.KEMKeyID) != ""
	if kemPublicPresent || kemSignaturePresent || kemKeyIDPresent {
		if !kemPublicPresent || !kemSignaturePresent || !kemKeyIDPresent {
			return CryptoDeviceBundleInput{}, fmt.Errorf("%w: kem bundle must be either fully present or fully absent", ErrInvalidArgument)
		}
	}

	var kemKeyID *string
	if kemKeyIDPresent {
		value := strings.TrimSpace(*input.KEMKeyID)
		kemKeyID = &value
	}

	if input.ExpiresAt != nil && !input.ExpiresAt.After(now) {
		return CryptoDeviceBundleInput{}, fmt.Errorf("%w: expires_at must be in the future", ErrInvalidArgument)
	}

	return CryptoDeviceBundleInput{
		CryptoSuite:             cryptoSuite,
		IdentityPublicKey:       cloneBytes(input.IdentityPublicKey),
		SignedPrekeyPublic:      cloneBytes(input.SignedPrekeyPublic),
		SignedPrekeyID:          signedPrekeyID,
		SignedPrekeySignature:   cloneBytes(input.SignedPrekeySignature),
		KEMPublicKey:            cloneBytes(input.KEMPublicKey),
		KEMKeyID:                kemKeyID,
		KEMSignature:            cloneBytes(input.KEMSignature),
		OneTimePrekeysTotal:     input.OneTimePrekeysTotal,
		OneTimePrekeysAvailable: input.OneTimePrekeysAvailable,
		BundleDigest:            cloneBytes(input.BundleDigest),
		ExpiresAt:               cloneTime(input.ExpiresAt),
	}, nil
}

func normalizeRequiredID(value string, fieldName string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", fmt.Errorf("%w: %s is required", ErrInvalidArgument, fieldName)
	}

	return trimmed, nil
}

func cloneBytes(value []byte) []byte {
	if len(value) == 0 {
		return nil
	}

	cloned := make([]byte, len(value))
	copy(cloned, value)
	return cloned
}

func cloneTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}

	cloned := value.UTC()
	return &cloned
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}

	return *value
}
