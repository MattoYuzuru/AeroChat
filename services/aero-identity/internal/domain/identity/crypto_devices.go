package identity

import "time"

const (
	CryptoDeviceStatusPendingLink = "pending_link"
	CryptoDeviceStatusActive      = "active"
	CryptoDeviceStatusRevoked     = "revoked"
)

const (
	CryptoDeviceRevokedBySelf         = "self"
	CryptoDeviceRevokedByLinkedDevice = "linked_device"
	CryptoDeviceRevokedByRecovery     = "recovery"
	CryptoDeviceRevokedByAccountReset = "account_reset"
)

const (
	CryptoDeviceLinkIntentStatusPending  = "pending"
	CryptoDeviceLinkIntentStatusApproved = "approved"
	CryptoDeviceLinkIntentStatusExpired  = "expired"
)

type CryptoDevice struct {
	ID                     string
	UserID                 string
	Label                  string
	Status                 string
	LinkedByCryptoDeviceID *string
	LastBundleVersion      *int64
	LastBundlePublishedAt  *time.Time
	CreatedAt              time.Time
	ActivatedAt            *time.Time
	RevokedAt              *time.Time
	RevocationReason       *string
	RevokedByActor         *string
}

type CryptoDeviceBundle struct {
	CryptoDeviceID          string
	BundleVersion           int64
	CryptoSuite             string
	IdentityPublicKey       []byte
	SignedPrekeyPublic      []byte
	SignedPrekeyID          string
	SignedPrekeySignature   []byte
	KEMPublicKey            []byte
	KEMKeyID                *string
	KEMSignature            []byte
	OneTimePrekeysTotal     int32
	OneTimePrekeysAvailable int32
	BundleDigest            []byte
	PublishedAt             time.Time
	ExpiresAt               *time.Time
	SupersededAt            *time.Time
}

type CryptoDeviceBundlePublishChallenge struct {
	CryptoDeviceID       string
	CurrentBundleVersion int64
	CurrentBundleDigest  []byte
	PublishChallenge     []byte
	CreatedAt            time.Time
	ExpiresAt            time.Time
}

type CryptoDeviceLinkIntent struct {
	ID                     string
	UserID                 string
	PendingCryptoDeviceID  string
	Status                 string
	BundleDigest           []byte
	CreatedAt              time.Time
	ExpiresAt              time.Time
	ApprovedAt             *time.Time
	ExpiredAt              *time.Time
	ApproverCryptoDeviceID *string
	ApprovalChallenge      []byte
}

type CryptoDeviceDetails struct {
	Device        CryptoDevice
	CurrentBundle *CryptoDeviceBundle
}

type CryptoDeviceLinkApprovalPayload struct {
	Version                uint32
	LinkIntentID           string
	ApproverCryptoDeviceID string
	PendingCryptoDeviceID  string
	PendingBundleDigest    []byte
	ApprovalChallenge      []byte
	ChallengeExpiresAt     time.Time
	IssuedAt               time.Time
}

type CryptoDeviceLinkApprovalProof struct {
	Payload   CryptoDeviceLinkApprovalPayload
	Signature []byte
}

type CryptoDeviceBundlePublishProofPayload struct {
	Version               uint32
	CryptoDeviceID        string
	PreviousBundleVersion int64
	PreviousBundleDigest  []byte
	NewBundleDigest       []byte
	PublishChallenge      []byte
	ChallengeExpiresAt    time.Time
	IssuedAt              time.Time
}

type CryptoDeviceBundlePublishProof struct {
	Payload   CryptoDeviceBundlePublishProofPayload
	Signature []byte
}

type CryptoDeviceBundleInput struct {
	CryptoSuite             string
	IdentityPublicKey       []byte
	SignedPrekeyPublic      []byte
	SignedPrekeyID          string
	SignedPrekeySignature   []byte
	KEMPublicKey            []byte
	KEMKeyID                *string
	KEMSignature            []byte
	OneTimePrekeysTotal     int32
	OneTimePrekeysAvailable int32
	BundleDigest            []byte
	ExpiresAt               *time.Time
}

type RegisterCryptoDeviceInput struct {
	DeviceLabel *string
	Bundle      CryptoDeviceBundleInput
}

type PublishCryptoDeviceBundleInput struct {
	CryptoDeviceID string
	Bundle         CryptoDeviceBundleInput
	Proof          *CryptoDeviceBundlePublishProof
}

type CreateCryptoDeviceParams struct {
	Device CryptoDevice
	Bundle CryptoDeviceBundle
}

type CreateCryptoDeviceLinkIntentParams struct {
	LinkIntent CryptoDeviceLinkIntent
}

type CreateCryptoDeviceBundlePublishChallengeParams struct {
	Challenge CryptoDeviceBundlePublishChallenge
}

type ApproveCryptoDeviceLinkIntentParams struct {
	UserID                 string
	LinkIntentID           string
	ApproverCryptoDeviceID string
	Proof                  CryptoDeviceLinkApprovalProof
	ApprovedAt             time.Time
}

type RevokeCryptoDeviceParams struct {
	UserID           string
	CryptoDeviceID   string
	RevokedAt        time.Time
	RevocationReason *string
	RevokedByActor   string
}
