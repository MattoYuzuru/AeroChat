package identity

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
	"time"
)

const (
	CryptoDeviceBundlePublishProofVersion = 1
)

func normalizeCryptoDeviceBundlePublishProof(input CryptoDeviceBundlePublishProof) (CryptoDeviceBundlePublishProof, error) {
	deviceID, err := normalizeRequiredID(input.Payload.CryptoDeviceID, "proof.payload.crypto_device_id")
	if err != nil {
		return CryptoDeviceBundlePublishProof{}, err
	}

	if input.Payload.Version != CryptoDeviceBundlePublishProofVersion {
		return CryptoDeviceBundlePublishProof{}, fmt.Errorf("%w: proof.payload.version is not supported", ErrInvalidArgument)
	}
	if input.Payload.PreviousBundleVersion <= 0 {
		return CryptoDeviceBundlePublishProof{}, fmt.Errorf("%w: proof.payload.previous_bundle_version must be positive", ErrInvalidArgument)
	}
	if len(input.Payload.PreviousBundleDigest) == 0 {
		return CryptoDeviceBundlePublishProof{}, fmt.Errorf("%w: proof.payload.previous_bundle_digest is required", ErrInvalidArgument)
	}
	if len(input.Payload.NewBundleDigest) == 0 {
		return CryptoDeviceBundlePublishProof{}, fmt.Errorf("%w: proof.payload.new_bundle_digest is required", ErrInvalidArgument)
	}
	if len(input.Payload.PublishChallenge) == 0 {
		return CryptoDeviceBundlePublishProof{}, fmt.Errorf("%w: proof.payload.publish_challenge is required", ErrInvalidArgument)
	}
	if input.Payload.ChallengeExpiresAt.IsZero() {
		return CryptoDeviceBundlePublishProof{}, fmt.Errorf("%w: proof.payload.challenge_expires_at is required", ErrInvalidArgument)
	}
	if input.Payload.IssuedAt.IsZero() {
		return CryptoDeviceBundlePublishProof{}, fmt.Errorf("%w: proof.payload.issued_at is required", ErrInvalidArgument)
	}
	if !input.Payload.ChallengeExpiresAt.After(input.Payload.IssuedAt) {
		return CryptoDeviceBundlePublishProof{}, fmt.Errorf("%w: proof.payload.challenge_expires_at must be after issued_at", ErrInvalidArgument)
	}
	if len(input.Signature) == 0 {
		return CryptoDeviceBundlePublishProof{}, fmt.Errorf("%w: proof.signature is required", ErrInvalidArgument)
	}

	return CryptoDeviceBundlePublishProof{
		Payload: CryptoDeviceBundlePublishProofPayload{
			Version:               input.Payload.Version,
			CryptoDeviceID:        deviceID,
			PreviousBundleVersion: input.Payload.PreviousBundleVersion,
			PreviousBundleDigest:  cloneBytes(input.Payload.PreviousBundleDigest),
			NewBundleDigest:       cloneBytes(input.Payload.NewBundleDigest),
			PublishChallenge:      cloneBytes(input.Payload.PublishChallenge),
			ChallengeExpiresAt:    input.Payload.ChallengeExpiresAt.UTC(),
			IssuedAt:              input.Payload.IssuedAt.UTC(),
		},
		Signature: cloneBytes(input.Signature),
	}, nil
}

// Подпись publish-proof строится по фиксированному строковому формату, чтобы worker и backend не расходились из-за сериализации.
func buildCryptoDeviceBundlePublishSigningMessage(payload CryptoDeviceBundlePublishProofPayload) []byte {
	var builder strings.Builder
	builder.WriteString("aerochat.crypto_device_bundle_publish.v1\n")
	_, _ = fmt.Fprintf(&builder, "version=%d", payload.Version)
	builder.WriteString("\ncrypto_device_id=")
	builder.WriteString(payload.CryptoDeviceID)
	_, _ = fmt.Fprintf(&builder, "\nprevious_bundle_version=%d", payload.PreviousBundleVersion)
	builder.WriteString("\nprevious_bundle_digest=")
	builder.WriteString(base64.StdEncoding.EncodeToString(payload.PreviousBundleDigest))
	builder.WriteString("\nnew_bundle_digest=")
	builder.WriteString(base64.StdEncoding.EncodeToString(payload.NewBundleDigest))
	builder.WriteString("\npublish_challenge=")
	builder.WriteString(base64.StdEncoding.EncodeToString(payload.PublishChallenge))
	builder.WriteString("\nchallenge_expires_at=")
	builder.WriteString(payload.ChallengeExpiresAt.UTC().Format(time.RFC3339Nano))
	builder.WriteString("\nissued_at=")
	builder.WriteString(payload.IssuedAt.UTC().Format(time.RFC3339Nano))
	builder.WriteString("\n")
	return []byte(builder.String())
}

func VerifyCryptoDeviceBundlePublishSignature(publicKeySPKI []byte, proof CryptoDeviceBundlePublishProof) error {
	parsedKey, err := x509.ParsePKIXPublicKey(publicKeySPKI)
	if err != nil {
		return fmt.Errorf("%w: invalid crypto device identity public key encoding", ErrConflict)
	}

	publicKey, ok := parsedKey.(*ecdsa.PublicKey)
	if !ok || publicKey.Curve != elliptic.P256() {
		return fmt.Errorf("%w: unsupported crypto device identity public key", ErrConflict)
	}
	if len(proof.Signature) != 64 {
		return fmt.Errorf("%w: unsupported bundle publish proof signature shape", ErrConflict)
	}

	messageDigest := sha256.Sum256(buildCryptoDeviceBundlePublishSigningMessage(proof.Payload))
	r := new(big.Int).SetBytes(proof.Signature[:32])
	s := new(big.Int).SetBytes(proof.Signature[32:])
	if !ecdsa.Verify(publicKey, messageDigest[:], r, s) {
		return fmt.Errorf("%w: bundle publish proof signature verification failed", ErrConflict)
	}

	return nil
}

type bundleDigestPayload struct {
	CryptoSuite             string `json:"cryptoSuite"`
	IdentityPublicKey       string `json:"identityPublicKey"`
	SignedPrekeyPublic      string `json:"signedPrekeyPublic"`
	SignedPrekeyID          string `json:"signedPrekeyId"`
	SignedPrekeySignature   string `json:"signedPrekeySignature"`
	OneTimePrekeysTotal     int32  `json:"oneTimePrekeysTotal"`
	OneTimePrekeysAvailable int32  `json:"oneTimePrekeysAvailable"`
}

func computeCryptoDeviceBundleDigest(input CryptoDeviceBundleInput) ([]byte, error) {
	payload, err := json.Marshal(bundleDigestPayload{
		CryptoSuite:             input.CryptoSuite,
		IdentityPublicKey:       base64.StdEncoding.EncodeToString(input.IdentityPublicKey),
		SignedPrekeyPublic:      base64.StdEncoding.EncodeToString(input.SignedPrekeyPublic),
		SignedPrekeyID:          input.SignedPrekeyID,
		SignedPrekeySignature:   base64.StdEncoding.EncodeToString(input.SignedPrekeySignature),
		OneTimePrekeysTotal:     input.OneTimePrekeysTotal,
		OneTimePrekeysAvailable: input.OneTimePrekeysAvailable,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal crypto bundle digest payload: %w", err)
	}

	digest := sha256.Sum256(payload)
	return digest[:], nil
}

func validateCryptoDeviceBundleConsistency(input CryptoDeviceBundleInput) error {
	parsedIdentityKey, err := x509.ParsePKIXPublicKey(input.IdentityPublicKey)
	if err != nil {
		return fmt.Errorf("%w: identity_public_key has invalid SPKI encoding", ErrInvalidArgument)
	}

	identityKey, ok := parsedIdentityKey.(*ecdsa.PublicKey)
	if !ok || identityKey.Curve != elliptic.P256() {
		return fmt.Errorf("%w: identity_public_key must be a P-256 public key for the current foundation suite", ErrInvalidArgument)
	}

	parsedSignedPrekey, err := x509.ParsePKIXPublicKey(input.SignedPrekeyPublic)
	if err != nil {
		return fmt.Errorf("%w: signed_prekey_public has invalid SPKI encoding", ErrInvalidArgument)
	}

	signedPrekeyKey, ok := parsedSignedPrekey.(*ecdsa.PublicKey)
	if !ok || signedPrekeyKey.Curve != elliptic.P256() {
		return fmt.Errorf("%w: signed_prekey_public must be a P-256 public key for the current foundation suite", ErrInvalidArgument)
	}

	if len(input.SignedPrekeySignature) != 64 {
		return fmt.Errorf("%w: signed_prekey_signature must use the current 64-byte raw ECDSA format", ErrInvalidArgument)
	}

	digest := sha256.Sum256(input.SignedPrekeyPublic)
	r := new(big.Int).SetBytes(input.SignedPrekeySignature[:32])
	s := new(big.Int).SetBytes(input.SignedPrekeySignature[32:])
	if !ecdsa.Verify(identityKey, digest[:], r, s) {
		return fmt.Errorf("%w: signed_prekey_signature does not verify against identity_public_key", ErrInvalidArgument)
	}

	computedDigest, err := computeCryptoDeviceBundleDigest(input)
	if err != nil {
		return err
	}
	if !bytes.Equal(computedDigest, input.BundleDigest) {
		return fmt.Errorf("%w: bundle_digest does not match canonical bundle payload", ErrInvalidArgument)
	}
	kemPublicPresent := len(input.KEMPublicKey) > 0
	kemSignaturePresent := len(input.KEMSignature) > 0
	kemKeyIDPresent := input.KEMKeyID != nil && strings.TrimSpace(*input.KEMKeyID) != ""
	if kemPublicPresent || kemSignaturePresent || kemKeyIDPresent {
		if !kemPublicPresent || !kemSignaturePresent || !kemKeyIDPresent {
			return fmt.Errorf("%w: kem bundle must be either fully present or fully absent", ErrInvalidArgument)
		}
	}

	return nil
}
