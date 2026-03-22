package postgres

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/domain/identity"
	identitysqlc "github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/storage/sqlc"
)

func (r *Repository) GetCryptoDeviceRegistryStatsByUserID(ctx context.Context, userID string) (int64, int64, int64, error) {
	row, err := r.queries.GetCryptoDeviceRegistryStatsByUserID(ctx, mustParseUUID(userID))
	if err != nil {
		return 0, 0, 0, convertError(err)
	}

	return row.TotalCount, row.ActiveCount, row.PendingCount, nil
}

func (r *Repository) CreateCryptoDevice(ctx context.Context, params identity.CreateCryptoDeviceParams) (*identity.CryptoDevice, *identity.CryptoDeviceBundle, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	deviceRow, err := q.CreateCryptoDevice(ctx, identitysqlc.CreateCryptoDeviceParams{
		ID:                     mustParseUUID(params.Device.ID),
		UserID:                 mustParseUUID(params.Device.UserID),
		Label:                  params.Device.Label,
		Status:                 params.Device.Status,
		LinkedByCryptoDeviceID: uuidValue(params.Device.LinkedByCryptoDeviceID),
		LastBundleVersion:      int8Value(params.Device.LastBundleVersion),
		LastBundlePublishedAt:  timestamptzValue(params.Device.LastBundlePublishedAt),
		CreatedAt:              timestampValue(params.Device.CreatedAt),
		ActivatedAt:            timestamptzValue(params.Device.ActivatedAt),
		RevokedAt:              timestamptzValue(params.Device.RevokedAt),
		RevocationReason:       textValue(params.Device.RevocationReason),
		RevokedByActor:         textValue(params.Device.RevokedByActor),
	})
	if err != nil {
		return nil, nil, convertError(err)
	}

	bundleRow, err := q.CreateCryptoDeviceBundle(ctx, identitysqlc.CreateCryptoDeviceBundleParams{
		CryptoDeviceID:          mustParseUUID(params.Device.ID),
		BundleVersion:           params.Bundle.BundleVersion,
		CryptoSuite:             params.Bundle.CryptoSuite,
		IdentityPublicKey:       params.Bundle.IdentityPublicKey,
		SignedPrekeyPublic:      params.Bundle.SignedPrekeyPublic,
		SignedPrekeyID:          params.Bundle.SignedPrekeyID,
		SignedPrekeySignature:   params.Bundle.SignedPrekeySignature,
		KemPublicKey:            params.Bundle.KEMPublicKey,
		KemKeyID:                textValue(params.Bundle.KEMKeyID),
		KemSignature:            params.Bundle.KEMSignature,
		OneTimePrekeysTotal:     params.Bundle.OneTimePrekeysTotal,
		OneTimePrekeysAvailable: params.Bundle.OneTimePrekeysAvailable,
		BundleDigest:            params.Bundle.BundleDigest,
		PublishedAt:             timestampValue(params.Bundle.PublishedAt),
		ExpiresAt:               timestamptzValue(params.Bundle.ExpiresAt),
		SupersededAt:            timestamptzValue(params.Bundle.SupersededAt),
	})
	if err != nil {
		return nil, nil, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("commit tx: %w", err)
	}

	device := toDomainCryptoDevice(deviceRow)
	bundle := toDomainCryptoDeviceBundle(bundleRow)
	return &device, &bundle, nil
}

func (r *Repository) ListCryptoDevices(ctx context.Context, userID string) ([]identity.CryptoDevice, error) {
	rows, err := r.queries.ListCryptoDevicesByUserID(ctx, mustParseUUID(userID))
	if err != nil {
		return nil, convertError(err)
	}

	devices := make([]identity.CryptoDevice, 0, len(rows))
	for _, row := range rows {
		devices = append(devices, toDomainCryptoDevice(row))
	}

	return devices, nil
}

func (r *Repository) GetCryptoDeviceDetails(ctx context.Context, userID string, cryptoDeviceID string) (*identity.CryptoDeviceDetails, error) {
	deviceRow, err := r.queries.GetCryptoDeviceByIDAndUserID(ctx, identitysqlc.GetCryptoDeviceByIDAndUserIDParams{
		ID:     mustParseUUID(cryptoDeviceID),
		UserID: mustParseUUID(userID),
	})
	if err != nil {
		return nil, convertError(err)
	}

	var currentBundle *identity.CryptoDeviceBundle
	bundleRow, err := r.queries.GetCurrentCryptoDeviceBundleByDeviceIDAndUserID(ctx, identitysqlc.GetCurrentCryptoDeviceBundleByDeviceIDAndUserIDParams{
		CryptoDeviceID: mustParseUUID(cryptoDeviceID),
		UserID:         mustParseUUID(userID),
	})
	switch {
	case err == nil:
		bundle := toDomainCryptoDeviceBundle(bundleRow)
		currentBundle = &bundle
	case errors.Is(err, pgx.ErrNoRows):
		currentBundle = nil
	default:
		return nil, convertError(err)
	}

	return &identity.CryptoDeviceDetails{
		Device:        toDomainCryptoDevice(deviceRow),
		CurrentBundle: currentBundle,
	}, nil
}

func (r *Repository) PublishCryptoDeviceBundle(ctx context.Context, userID string, input identity.PublishCryptoDeviceBundleInput, publishedAt time.Time) (*identity.CryptoDevice, *identity.CryptoDeviceBundle, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	deviceRow, err := q.GetCryptoDeviceByIDAndUserID(ctx, identitysqlc.GetCryptoDeviceByIDAndUserIDParams{
		ID:     mustParseUUID(input.CryptoDeviceID),
		UserID: mustParseUUID(userID),
	})
	if err != nil {
		return nil, nil, convertError(err)
	}
	if deviceRow.Status == identity.CryptoDeviceStatusRevoked {
		return nil, nil, identity.ErrConflict
	}

	currentBundleRow, err := q.GetCurrentCryptoDeviceBundleByDeviceID(ctx, mustParseUUID(input.CryptoDeviceID))
	if err != nil {
		return nil, nil, convertError(err)
	}
	if !bytes.Equal(currentBundleRow.IdentityPublicKey, input.Bundle.IdentityPublicKey) {
		return nil, nil, fmt.Errorf("%w: crypto device identity_public_key is immutable across bundle publish", identity.ErrConflict)
	}

	if _, err := q.SupersedeCurrentCryptoDeviceBundle(ctx, identitysqlc.SupersedeCurrentCryptoDeviceBundleParams{
		CryptoDeviceID: mustParseUUID(input.CryptoDeviceID),
		SupersededAt:   timestampValue(publishedAt),
	}); err != nil {
		return nil, nil, convertError(err)
	}

	nextVersion := currentBundleRow.BundleVersion + 1
	bundleRow, err := q.CreateCryptoDeviceBundle(ctx, identitysqlc.CreateCryptoDeviceBundleParams{
		CryptoDeviceID:          mustParseUUID(input.CryptoDeviceID),
		BundleVersion:           nextVersion,
		CryptoSuite:             input.Bundle.CryptoSuite,
		IdentityPublicKey:       input.Bundle.IdentityPublicKey,
		SignedPrekeyPublic:      input.Bundle.SignedPrekeyPublic,
		SignedPrekeyID:          input.Bundle.SignedPrekeyID,
		SignedPrekeySignature:   input.Bundle.SignedPrekeySignature,
		KemPublicKey:            input.Bundle.KEMPublicKey,
		KemKeyID:                textValue(input.Bundle.KEMKeyID),
		KemSignature:            input.Bundle.KEMSignature,
		OneTimePrekeysTotal:     input.Bundle.OneTimePrekeysTotal,
		OneTimePrekeysAvailable: input.Bundle.OneTimePrekeysAvailable,
		BundleDigest:            input.Bundle.BundleDigest,
		PublishedAt:             timestampValue(publishedAt),
		ExpiresAt:               timestamptzValue(input.Bundle.ExpiresAt),
		SupersededAt:            pgtype.Timestamptz{},
	})
	if err != nil {
		return nil, nil, convertError(err)
	}

	deviceRow, err = q.UpdateCryptoDeviceBundleTracking(ctx, identitysqlc.UpdateCryptoDeviceBundleTrackingParams{
		ID:                    mustParseUUID(input.CryptoDeviceID),
		UserID:                mustParseUUID(userID),
		LastBundleVersion:     pgtype.Int8{Int64: nextVersion, Valid: true},
		LastBundlePublishedAt: timestampValue(publishedAt),
	})
	if err != nil {
		return nil, nil, convertError(err)
	}

	if deviceRow.Status == identity.CryptoDeviceStatusPendingLink {
		if _, err := q.ExpirePendingCryptoDeviceLinkIntentsByDeviceID(ctx, identitysqlc.ExpirePendingCryptoDeviceLinkIntentsByDeviceIDParams{
			PendingCryptoDeviceID: mustParseUUID(input.CryptoDeviceID),
			ExpiredAt:             timestampValue(publishedAt),
		}); err != nil {
			return nil, nil, convertError(err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("commit tx: %w", err)
	}

	device := toDomainCryptoDevice(deviceRow)
	bundle := toDomainCryptoDeviceBundle(bundleRow)
	return &device, &bundle, nil
}

func (r *Repository) CreateCryptoDeviceLinkIntent(ctx context.Context, params identity.CreateCryptoDeviceLinkIntentParams) (*identity.CryptoDeviceLinkIntent, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	if _, err := q.ExpireStaleCryptoDeviceLinkIntentsByUserID(ctx, identitysqlc.ExpireStaleCryptoDeviceLinkIntentsByUserIDParams{
		UserID:    mustParseUUID(params.LinkIntent.UserID),
		ExpiredAt: timestampValue(params.LinkIntent.CreatedAt),
	}); err != nil {
		return nil, convertError(err)
	}

	deviceRow, err := q.GetCryptoDeviceByIDAndUserID(ctx, identitysqlc.GetCryptoDeviceByIDAndUserIDParams{
		ID:     mustParseUUID(params.LinkIntent.PendingCryptoDeviceID),
		UserID: mustParseUUID(params.LinkIntent.UserID),
	})
	if err != nil {
		return nil, convertError(err)
	}
	if deviceRow.Status != identity.CryptoDeviceStatusPendingLink {
		return nil, identity.ErrConflict
	}

	currentBundleRow, err := q.GetCurrentCryptoDeviceBundleByDeviceID(ctx, mustParseUUID(params.LinkIntent.PendingCryptoDeviceID))
	if err != nil {
		return nil, convertError(err)
	}
	if !bytes.Equal(currentBundleRow.BundleDigest, params.LinkIntent.BundleDigest) {
		return nil, identity.ErrConflict
	}

	_, err = q.GetPendingCryptoDeviceLinkIntentByDeviceID(ctx, mustParseUUID(params.LinkIntent.PendingCryptoDeviceID))
	if err == nil {
		return nil, identity.ErrConflict
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, convertError(err)
	}

	linkIntentRow, err := q.CreateCryptoDeviceLinkIntent(ctx, identitysqlc.CreateCryptoDeviceLinkIntentParams{
		ID:                       mustParseUUID(params.LinkIntent.ID),
		UserID:                   mustParseUUID(params.LinkIntent.UserID),
		PendingCryptoDeviceID:    mustParseUUID(params.LinkIntent.PendingCryptoDeviceID),
		Status:                   params.LinkIntent.Status,
		BundleDigest:             params.LinkIntent.BundleDigest,
		ApprovalChallenge:        params.LinkIntent.ApprovalChallenge,
		CreatedAt:                timestampValue(params.LinkIntent.CreatedAt),
		ExpiresAt:                timestampValue(params.LinkIntent.ExpiresAt),
		ApprovedAt:               timestamptzValue(params.LinkIntent.ApprovedAt),
		ExpiredAt:                timestamptzValue(params.LinkIntent.ExpiredAt),
		ApprovedByCryptoDeviceID: uuidValue(params.LinkIntent.ApproverCryptoDeviceID),
	})
	if err != nil {
		return nil, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}

	linkIntent := toDomainCryptoDeviceLinkIntent(linkIntentRow)
	return &linkIntent, nil
}

func (r *Repository) ListCryptoDeviceLinkIntents(ctx context.Context, userID string, now time.Time) ([]identity.CryptoDeviceLinkIntent, error) {
	if _, err := r.queries.ExpireStaleCryptoDeviceLinkIntentsByUserID(ctx, identitysqlc.ExpireStaleCryptoDeviceLinkIntentsByUserIDParams{
		UserID:    mustParseUUID(userID),
		ExpiredAt: timestampValue(now),
	}); err != nil {
		return nil, convertError(err)
	}

	rows, err := r.queries.ListCryptoDeviceLinkIntentsByUserID(ctx, mustParseUUID(userID))
	if err != nil {
		return nil, convertError(err)
	}

	linkIntents := make([]identity.CryptoDeviceLinkIntent, 0, len(rows))
	for _, row := range rows {
		linkIntents = append(linkIntents, toDomainCryptoDeviceLinkIntent(row))
	}

	return linkIntents, nil
}

func (r *Repository) ApproveCryptoDeviceLinkIntent(ctx context.Context, params identity.ApproveCryptoDeviceLinkIntentParams) (*identity.CryptoDeviceLinkIntent, *identity.CryptoDevice, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	linkIntentRow, err := q.GetCryptoDeviceLinkIntentByIDAndUserID(ctx, identitysqlc.GetCryptoDeviceLinkIntentByIDAndUserIDParams{
		ID:     mustParseUUID(params.LinkIntentID),
		UserID: mustParseUUID(params.UserID),
	})
	if err != nil {
		return nil, nil, convertError(err)
	}

	if linkIntentRow.Status == identity.CryptoDeviceLinkIntentStatusApproved {
		return nil, nil, identity.ErrConflict
	}
	if linkIntentRow.Status == identity.CryptoDeviceLinkIntentStatusExpired {
		return nil, nil, identity.ErrConflict
	}
	if params.Proof.Payload.LinkIntentID != params.LinkIntentID {
		return nil, nil, fmt.Errorf("%w: approval proof link_intent_id mismatch", identity.ErrConflict)
	}
	if params.Proof.Payload.ApproverCryptoDeviceID != params.ApproverCryptoDeviceID {
		return nil, nil, fmt.Errorf("%w: approval proof approver_crypto_device_id mismatch", identity.ErrConflict)
	}
	if !linkIntentRow.ExpiresAt.Time.After(params.ApprovedAt) {
		expiredRow, expireErr := q.ExpireCryptoDeviceLinkIntentByIDAndUserID(ctx, identitysqlc.ExpireCryptoDeviceLinkIntentByIDAndUserIDParams{
			ID:        mustParseUUID(params.LinkIntentID),
			UserID:    mustParseUUID(params.UserID),
			ExpiredAt: timestampValue(params.ApprovedAt),
		})
		if expireErr != nil && !errors.Is(expireErr, pgx.ErrNoRows) {
			return nil, nil, convertError(expireErr)
		}
		_ = expiredRow
		return nil, nil, identity.ErrConflict
	}

	pendingDeviceRow, err := q.GetCryptoDeviceByIDAndUserID(ctx, identitysqlc.GetCryptoDeviceByIDAndUserIDParams{
		ID:     linkIntentRow.PendingCryptoDeviceID,
		UserID: mustParseUUID(params.UserID),
	})
	if err != nil {
		return nil, nil, convertError(err)
	}
	if pendingDeviceRow.Status != identity.CryptoDeviceStatusPendingLink {
		return nil, nil, identity.ErrConflict
	}
	if params.ApproverCryptoDeviceID == pendingDeviceRow.ID.String() {
		return nil, nil, fmt.Errorf("%w: pending crypto device cannot self-approve link intent", identity.ErrConflict)
	}

	currentBundleRow, err := q.GetCurrentCryptoDeviceBundleByDeviceID(ctx, linkIntentRow.PendingCryptoDeviceID)
	if err != nil {
		return nil, nil, convertError(err)
	}
	if !bytes.Equal(currentBundleRow.BundleDigest, linkIntentRow.BundleDigest) {
		if _, err := q.ExpireCryptoDeviceLinkIntentByIDAndUserID(ctx, identitysqlc.ExpireCryptoDeviceLinkIntentByIDAndUserIDParams{
			ID:        mustParseUUID(params.LinkIntentID),
			UserID:    mustParseUUID(params.UserID),
			ExpiredAt: timestampValue(params.ApprovedAt),
		}); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, convertError(err)
		}
		return nil, nil, identity.ErrConflict
	}
	if params.Proof.Payload.PendingCryptoDeviceID != pendingDeviceRow.ID.String() {
		return nil, nil, fmt.Errorf("%w: approval proof pending_crypto_device_id mismatch", identity.ErrConflict)
	}
	if !bytes.Equal(params.Proof.Payload.PendingBundleDigest, currentBundleRow.BundleDigest) {
		return nil, nil, fmt.Errorf("%w: approval proof pending_bundle_digest mismatch", identity.ErrConflict)
	}
	if !bytes.Equal(params.Proof.Payload.ApprovalChallenge, linkIntentRow.ApprovalChallenge) {
		return nil, nil, fmt.Errorf("%w: approval proof challenge mismatch", identity.ErrConflict)
	}
	if !params.Proof.Payload.ChallengeExpiresAt.Equal(linkIntentRow.ExpiresAt.Time.UTC()) {
		return nil, nil, fmt.Errorf("%w: approval proof challenge_expires_at mismatch", identity.ErrConflict)
	}
	if params.Proof.Payload.IssuedAt.Before(linkIntentRow.CreatedAt.Time.UTC()) {
		return nil, nil, fmt.Errorf("%w: approval proof issued_at is earlier than link intent creation", identity.ErrConflict)
	}
	if params.Proof.Payload.IssuedAt.After(params.ApprovedAt) {
		return nil, nil, fmt.Errorf("%w: approval proof issued_at is in the future", identity.ErrConflict)
	}

	approverDeviceRow, err := q.GetCryptoDeviceByIDAndUserID(ctx, identitysqlc.GetCryptoDeviceByIDAndUserIDParams{
		ID:     mustParseUUID(params.ApproverCryptoDeviceID),
		UserID: mustParseUUID(params.UserID),
	})
	if err != nil {
		return nil, nil, convertError(err)
	}
	if approverDeviceRow.Status != identity.CryptoDeviceStatusActive || approverDeviceRow.RevokedAt.Valid {
		return nil, nil, identity.ErrConflict
	}
	approverBundleRow, err := q.GetCurrentCryptoDeviceBundleByDeviceID(ctx, mustParseUUID(params.ApproverCryptoDeviceID))
	if err != nil {
		return nil, nil, convertError(err)
	}
	if err := identity.VerifyCryptoDeviceLinkApprovalSignature(approverBundleRow.IdentityPublicKey, params.Proof); err != nil {
		return nil, nil, err
	}

	approvedLinkIntentRow, err := q.ApproveCryptoDeviceLinkIntentByIDAndUserID(ctx, identitysqlc.ApproveCryptoDeviceLinkIntentByIDAndUserIDParams{
		ID:                       mustParseUUID(params.LinkIntentID),
		UserID:                   mustParseUUID(params.UserID),
		ApprovedAt:               timestampValue(params.ApprovedAt),
		ApprovedByCryptoDeviceID: uuidValue(&params.ApproverCryptoDeviceID),
	})
	if err != nil {
		return nil, nil, convertError(err)
	}

	activatedDeviceRow, err := q.ActivateCryptoDevice(ctx, identitysqlc.ActivateCryptoDeviceParams{
		ID:                     approvedLinkIntentRow.PendingCryptoDeviceID,
		UserID:                 mustParseUUID(params.UserID),
		ActivatedAt:            timestampValue(params.ApprovedAt),
		LinkedByCryptoDeviceID: uuidValue(&params.ApproverCryptoDeviceID),
	})
	if err != nil {
		return nil, nil, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("commit tx: %w", err)
	}

	linkIntent := toDomainCryptoDeviceLinkIntent(approvedLinkIntentRow)
	device := toDomainCryptoDevice(activatedDeviceRow)
	return &linkIntent, &device, nil
}

func (r *Repository) ExpireCryptoDeviceLinkIntent(ctx context.Context, userID string, linkIntentID string, now time.Time) (*identity.CryptoDeviceLinkIntent, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	linkIntentRow, err := q.GetCryptoDeviceLinkIntentByIDAndUserID(ctx, identitysqlc.GetCryptoDeviceLinkIntentByIDAndUserIDParams{
		ID:     mustParseUUID(linkIntentID),
		UserID: mustParseUUID(userID),
	})
	if err != nil {
		return nil, convertError(err)
	}

	switch linkIntentRow.Status {
	case identity.CryptoDeviceLinkIntentStatusExpired:
		linkIntent := toDomainCryptoDeviceLinkIntent(linkIntentRow)
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("commit tx: %w", err)
		}
		return &linkIntent, nil
	case identity.CryptoDeviceLinkIntentStatusApproved:
		return nil, identity.ErrConflict
	}

	expiredLinkIntentRow, err := q.ExpireCryptoDeviceLinkIntentByIDAndUserID(ctx, identitysqlc.ExpireCryptoDeviceLinkIntentByIDAndUserIDParams{
		ID:        mustParseUUID(linkIntentID),
		UserID:    mustParseUUID(userID),
		ExpiredAt: timestampValue(now),
	})
	if err != nil {
		return nil, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}

	linkIntent := toDomainCryptoDeviceLinkIntent(expiredLinkIntentRow)
	return &linkIntent, nil
}

func (r *Repository) RevokeCryptoDevice(ctx context.Context, params identity.RevokeCryptoDeviceParams) (*identity.CryptoDevice, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	deviceRow, err := q.GetCryptoDeviceByIDAndUserID(ctx, identitysqlc.GetCryptoDeviceByIDAndUserIDParams{
		ID:     mustParseUUID(params.CryptoDeviceID),
		UserID: mustParseUUID(params.UserID),
	})
	if err != nil {
		return nil, convertError(err)
	}

	if deviceRow.Status == identity.CryptoDeviceStatusRevoked {
		device := toDomainCryptoDevice(deviceRow)
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("commit tx: %w", err)
		}
		return &device, nil
	}

	deviceRow, err = q.RevokeCryptoDeviceWithMetadata(ctx, identitysqlc.RevokeCryptoDeviceWithMetadataParams{
		ID:               mustParseUUID(params.CryptoDeviceID),
		UserID:           mustParseUUID(params.UserID),
		RevokedAt:        timestampValue(params.RevokedAt),
		RevocationReason: textValue(params.RevocationReason),
		RevokedByActor:   pgtype.Text{String: params.RevokedByActor, Valid: params.RevokedByActor != ""},
	})
	if err != nil {
		return nil, convertError(err)
	}

	if _, err := q.ExpirePendingCryptoDeviceLinkIntentsByDeviceID(ctx, identitysqlc.ExpirePendingCryptoDeviceLinkIntentsByDeviceIDParams{
		PendingCryptoDeviceID: mustParseUUID(params.CryptoDeviceID),
		ExpiredAt:             timestampValue(params.RevokedAt),
	}); err != nil {
		return nil, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}

	device := toDomainCryptoDevice(deviceRow)
	return &device, nil
}

func toDomainCryptoDevice(row identitysqlc.CryptoDevice) identity.CryptoDevice {
	return identity.CryptoDevice{
		ID:                     row.ID.String(),
		UserID:                 row.UserID.String(),
		Label:                  row.Label,
		Status:                 row.Status,
		LinkedByCryptoDeviceID: uuidPointer(row.LinkedByCryptoDeviceID),
		LastBundleVersion:      int8Pointer(row.LastBundleVersion),
		LastBundlePublishedAt:  timestamptzPointer(row.LastBundlePublishedAt),
		CreatedAt:              timestampPointer(row.CreatedAt),
		ActivatedAt:            timestamptzPointer(row.ActivatedAt),
		RevokedAt:              timestamptzPointer(row.RevokedAt),
		RevocationReason:       textPointer(row.RevocationReason),
		RevokedByActor:         textPointer(row.RevokedByActor),
	}
}

func toDomainCryptoDeviceBundle(row identitysqlc.CryptoDeviceBundle) identity.CryptoDeviceBundle {
	return identity.CryptoDeviceBundle{
		CryptoDeviceID:          row.CryptoDeviceID.String(),
		BundleVersion:           row.BundleVersion,
		CryptoSuite:             row.CryptoSuite,
		IdentityPublicKey:       cloneByteSlice(row.IdentityPublicKey),
		SignedPrekeyPublic:      cloneByteSlice(row.SignedPrekeyPublic),
		SignedPrekeyID:          row.SignedPrekeyID,
		SignedPrekeySignature:   cloneByteSlice(row.SignedPrekeySignature),
		KEMPublicKey:            cloneByteSlice(row.KemPublicKey),
		KEMKeyID:                textPointer(row.KemKeyID),
		KEMSignature:            cloneByteSlice(row.KemSignature),
		OneTimePrekeysTotal:     row.OneTimePrekeysTotal,
		OneTimePrekeysAvailable: row.OneTimePrekeysAvailable,
		BundleDigest:            cloneByteSlice(row.BundleDigest),
		PublishedAt:             timestampPointer(row.PublishedAt),
		ExpiresAt:               timestamptzPointer(row.ExpiresAt),
		SupersededAt:            timestamptzPointer(row.SupersededAt),
	}
}

func toDomainCryptoDeviceLinkIntent(row any) identity.CryptoDeviceLinkIntent {
	switch value := row.(type) {
	case identitysqlc.CryptoDeviceLinkIntent:
		return toDomainCryptoDeviceLinkIntentFields(
			value.ID,
			value.UserID,
			value.PendingCryptoDeviceID,
			value.Status,
			value.BundleDigest,
			value.ApprovalChallenge,
			value.CreatedAt,
			value.ExpiresAt,
			value.ApprovedAt,
			value.ExpiredAt,
			value.ApprovedByCryptoDeviceID,
		)
	case identitysqlc.CreateCryptoDeviceLinkIntentRow:
		return toDomainCryptoDeviceLinkIntentFields(
			value.ID,
			value.UserID,
			value.PendingCryptoDeviceID,
			value.Status,
			value.BundleDigest,
			value.ApprovalChallenge,
			value.CreatedAt,
			value.ExpiresAt,
			value.ApprovedAt,
			value.ExpiredAt,
			value.ApprovedByCryptoDeviceID,
		)
	case identitysqlc.GetCryptoDeviceLinkIntentByIDAndUserIDRow:
		return toDomainCryptoDeviceLinkIntentFields(
			value.ID,
			value.UserID,
			value.PendingCryptoDeviceID,
			value.Status,
			value.BundleDigest,
			value.ApprovalChallenge,
			value.CreatedAt,
			value.ExpiresAt,
			value.ApprovedAt,
			value.ExpiredAt,
			value.ApprovedByCryptoDeviceID,
		)
	case identitysqlc.ListCryptoDeviceLinkIntentsByUserIDRow:
		return toDomainCryptoDeviceLinkIntentFields(
			value.ID,
			value.UserID,
			value.PendingCryptoDeviceID,
			value.Status,
			value.BundleDigest,
			value.ApprovalChallenge,
			value.CreatedAt,
			value.ExpiresAt,
			value.ApprovedAt,
			value.ExpiredAt,
			value.ApprovedByCryptoDeviceID,
		)
	case identitysqlc.ApproveCryptoDeviceLinkIntentByIDAndUserIDRow:
		return toDomainCryptoDeviceLinkIntentFields(
			value.ID,
			value.UserID,
			value.PendingCryptoDeviceID,
			value.Status,
			value.BundleDigest,
			value.ApprovalChallenge,
			value.CreatedAt,
			value.ExpiresAt,
			value.ApprovedAt,
			value.ExpiredAt,
			value.ApprovedByCryptoDeviceID,
		)
	case identitysqlc.ExpireCryptoDeviceLinkIntentByIDAndUserIDRow:
		return toDomainCryptoDeviceLinkIntentFields(
			value.ID,
			value.UserID,
			value.PendingCryptoDeviceID,
			value.Status,
			value.BundleDigest,
			value.ApprovalChallenge,
			value.CreatedAt,
			value.ExpiresAt,
			value.ApprovedAt,
			value.ExpiredAt,
			value.ApprovedByCryptoDeviceID,
		)
	default:
		panic(fmt.Sprintf("unsupported crypto device link intent row type %T", row))
	}
}

func toDomainCryptoDeviceLinkIntentFields(
	id uuid.UUID,
	userID uuid.UUID,
	pendingCryptoDeviceID uuid.UUID,
	status string,
	bundleDigest []byte,
	approvalChallenge []byte,
	createdAt pgtype.Timestamptz,
	expiresAt pgtype.Timestamptz,
	approvedAt pgtype.Timestamptz,
	expiredAt pgtype.Timestamptz,
	approvedByCryptoDeviceID pgtype.UUID,
) identity.CryptoDeviceLinkIntent {
	return identity.CryptoDeviceLinkIntent{
		ID:                     id.String(),
		UserID:                 userID.String(),
		PendingCryptoDeviceID:  pendingCryptoDeviceID.String(),
		Status:                 status,
		BundleDigest:           cloneByteSlice(bundleDigest),
		ApprovalChallenge:      cloneByteSlice(approvalChallenge),
		CreatedAt:              timestampPointer(createdAt),
		ExpiresAt:              timestampPointer(expiresAt),
		ApprovedAt:             timestamptzPointer(approvedAt),
		ExpiredAt:              timestamptzPointer(expiredAt),
		ApproverCryptoDeviceID: uuidPointer(approvedByCryptoDeviceID),
	}
}

func uuidValue(value *string) pgtype.UUID {
	if value == nil {
		return pgtype.UUID{}
	}

	parsed := mustParseUUID(*value)
	return pgtype.UUID{Bytes: parsed, Valid: true}
}

func uuidPointer(value pgtype.UUID) *string {
	if !value.Valid {
		return nil
	}

	parsed := uuid.UUID(value.Bytes).String()
	return &parsed
}

func int8Value(value *int64) pgtype.Int8 {
	if value == nil {
		return pgtype.Int8{}
	}

	return pgtype.Int8{Int64: *value, Valid: true}
}

func int8Pointer(value pgtype.Int8) *int64 {
	if !value.Valid {
		return nil
	}

	number := value.Int64
	return &number
}

func cloneByteSlice(value []byte) []byte {
	if len(value) == 0 {
		return nil
	}

	cloned := make([]byte, len(value))
	copy(cloned, value)
	return cloned
}
