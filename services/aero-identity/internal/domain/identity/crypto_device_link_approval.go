package identity

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"fmt"
	"math/big"
	"strings"
	"time"
)

const (
	CryptoDeviceLinkApprovalProofVersion = 1
)

func normalizeCryptoDeviceLinkApprovalProof(input CryptoDeviceLinkApprovalProof) (CryptoDeviceLinkApprovalProof, error) {
	linkIntentID, err := normalizeRequiredID(input.Payload.LinkIntentID, "proof.payload.link_intent_id")
	if err != nil {
		return CryptoDeviceLinkApprovalProof{}, err
	}

	approverID, err := normalizeRequiredID(input.Payload.ApproverCryptoDeviceID, "proof.payload.approver_crypto_device_id")
	if err != nil {
		return CryptoDeviceLinkApprovalProof{}, err
	}

	pendingID, err := normalizeRequiredID(input.Payload.PendingCryptoDeviceID, "proof.payload.pending_crypto_device_id")
	if err != nil {
		return CryptoDeviceLinkApprovalProof{}, err
	}

	if input.Payload.Version != CryptoDeviceLinkApprovalProofVersion {
		return CryptoDeviceLinkApprovalProof{}, fmt.Errorf("%w: proof.payload.version is not supported", ErrInvalidArgument)
	}
	if len(input.Payload.PendingBundleDigest) == 0 {
		return CryptoDeviceLinkApprovalProof{}, fmt.Errorf("%w: proof.payload.pending_bundle_digest is required", ErrInvalidArgument)
	}
	if len(input.Payload.ApprovalChallenge) == 0 {
		return CryptoDeviceLinkApprovalProof{}, fmt.Errorf("%w: proof.payload.approval_challenge is required", ErrInvalidArgument)
	}
	if input.Payload.ChallengeExpiresAt.IsZero() {
		return CryptoDeviceLinkApprovalProof{}, fmt.Errorf("%w: proof.payload.challenge_expires_at is required", ErrInvalidArgument)
	}
	if input.Payload.IssuedAt.IsZero() {
		return CryptoDeviceLinkApprovalProof{}, fmt.Errorf("%w: proof.payload.issued_at is required", ErrInvalidArgument)
	}
	if !input.Payload.ChallengeExpiresAt.After(input.Payload.IssuedAt) {
		return CryptoDeviceLinkApprovalProof{}, fmt.Errorf("%w: proof.payload.challenge_expires_at must be after issued_at", ErrInvalidArgument)
	}
	if len(input.Signature) == 0 {
		return CryptoDeviceLinkApprovalProof{}, fmt.Errorf("%w: proof.signature is required", ErrInvalidArgument)
	}

	return CryptoDeviceLinkApprovalProof{
		Payload: CryptoDeviceLinkApprovalPayload{
			Version:                input.Payload.Version,
			LinkIntentID:           linkIntentID,
			ApproverCryptoDeviceID: approverID,
			PendingCryptoDeviceID:  pendingID,
			PendingBundleDigest:    cloneBytes(input.Payload.PendingBundleDigest),
			ApprovalChallenge:      cloneBytes(input.Payload.ApprovalChallenge),
			ChallengeExpiresAt:     input.Payload.ChallengeExpiresAt.UTC(),
			IssuedAt:               input.Payload.IssuedAt.UTC(),
		},
		Signature: cloneBytes(input.Signature),
	}, nil
}

// Подпись строится по фиксированному строковому формату, чтобы worker и backend проверяли один и тот же payload без неявной сериализации.
func buildCryptoDeviceLinkApprovalSigningMessage(payload CryptoDeviceLinkApprovalPayload) []byte {
	var builder strings.Builder
	builder.WriteString("aerochat.crypto_device_link_approval.v1\n")
	_, _ = fmt.Fprintf(&builder, "version=%d", payload.Version)
	builder.WriteString("\nlink_intent_id=")
	builder.WriteString(payload.LinkIntentID)
	builder.WriteString("\napprover_crypto_device_id=")
	builder.WriteString(payload.ApproverCryptoDeviceID)
	builder.WriteString("\npending_crypto_device_id=")
	builder.WriteString(payload.PendingCryptoDeviceID)
	builder.WriteString("\npending_bundle_digest=")
	builder.WriteString(base64.StdEncoding.EncodeToString(payload.PendingBundleDigest))
	builder.WriteString("\napproval_challenge=")
	builder.WriteString(base64.StdEncoding.EncodeToString(payload.ApprovalChallenge))
	builder.WriteString("\nchallenge_expires_at=")
	builder.WriteString(payload.ChallengeExpiresAt.UTC().Format(time.RFC3339Nano))
	builder.WriteString("\nissued_at=")
	builder.WriteString(payload.IssuedAt.UTC().Format(time.RFC3339Nano))
	builder.WriteString("\n")
	return []byte(builder.String())
}

func VerifyCryptoDeviceLinkApprovalSignature(publicKeySPKI []byte, proof CryptoDeviceLinkApprovalProof) error {
	parsedKey, err := x509.ParsePKIXPublicKey(publicKeySPKI)
	if err != nil {
		return fmt.Errorf("%w: invalid approver identity public key encoding", ErrConflict)
	}

	publicKey, ok := parsedKey.(*ecdsa.PublicKey)
	if !ok || publicKey.Curve != elliptic.P256() {
		return fmt.Errorf("%w: unsupported approver identity public key", ErrConflict)
	}
	if len(proof.Signature) != 64 {
		return fmt.Errorf("%w: unsupported approval proof signature shape", ErrConflict)
	}

	messageDigest := sha256.Sum256(buildCryptoDeviceLinkApprovalSigningMessage(proof.Payload))
	r := new(big.Int).SetBytes(proof.Signature[:32])
	s := new(big.Int).SetBytes(proof.Signature[32:])
	if !ecdsa.Verify(publicKey, messageDigest[:], r, s) {
		return fmt.Errorf("%w: approval proof signature verification failed", ErrConflict)
	}

	return nil
}
