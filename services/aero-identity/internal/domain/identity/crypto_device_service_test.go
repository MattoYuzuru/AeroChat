package identity

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"errors"
	"testing"
	"time"
)

func TestRegisterFirstAndPendingCryptoDevices(t *testing.T) {
	t.Parallel()

	service := newTestService()
	authSession := mustRegister(t, service, "crypto-owner", "Crypto Owner")
	firstDeviceMaterial := newTestCryptoDeviceMaterial(t)

	firstDetails, err := service.RegisterFirstCryptoDevice(context.Background(), authSession.Token, RegisterCryptoDeviceInput{
		DeviceLabel: strPtr("Основной крипто-девайс"),
		Bundle:      firstDeviceMaterial.BundleInput(1),
	})
	if err != nil {
		t.Fatalf("register first crypto device: %v", err)
	}
	if firstDetails.Device.Status != CryptoDeviceStatusActive {
		t.Fatalf("ожидался active first crypto device, получено %q", firstDetails.Device.Status)
	}
	if firstDetails.CurrentBundle == nil || firstDetails.CurrentBundle.BundleVersion != 1 {
		t.Fatal("ожидался initial current bundle version 1")
	}

	if _, err := service.RegisterFirstCryptoDevice(context.Background(), authSession.Token, RegisterCryptoDeviceInput{
		Bundle: newTestCryptoDeviceMaterial(t).BundleInput(2),
	}); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка повторного first-device bootstrap, получено %v", err)
	}

	pendingDeviceMaterial := newTestCryptoDeviceMaterial(t)
	pendingDetails, err := service.RegisterPendingLinkedCryptoDevice(context.Background(), authSession.Token, RegisterCryptoDeviceInput{
		DeviceLabel: strPtr("Связываемое устройство"),
		Bundle:      pendingDeviceMaterial.BundleInput(3),
	})
	if err != nil {
		t.Fatalf("register pending linked crypto device: %v", err)
	}
	if pendingDetails.Device.Status != CryptoDeviceStatusPendingLink {
		t.Fatalf("ожидался pending_link device, получено %q", pendingDetails.Device.Status)
	}

	devices, err := service.ListCryptoDevices(context.Background(), authSession.Token)
	if err != nil {
		t.Fatalf("list crypto devices: %v", err)
	}
	if len(devices) != 2 {
		t.Fatalf("ожидалось 2 crypto devices, получено %d", len(devices))
	}
}

func TestCryptoDeviceLinkIntentApprovalFlow(t *testing.T) {
	t.Parallel()

	service := newTestService()
	authSession := mustRegister(t, service, "crypto-link", "Crypto Link")
	firstDeviceMaterial := newTestCryptoDeviceMaterial(t)

	firstDetails, err := service.RegisterFirstCryptoDevice(context.Background(), authSession.Token, RegisterCryptoDeviceInput{
		Bundle: firstDeviceMaterial.BundleInput(10),
	})
	if err != nil {
		t.Fatalf("register first crypto device: %v", err)
	}

	pendingDeviceMaterial := newTestCryptoDeviceMaterial(t)
	pendingDetails, err := service.RegisterPendingLinkedCryptoDevice(context.Background(), authSession.Token, RegisterCryptoDeviceInput{
		Bundle: pendingDeviceMaterial.BundleInput(11),
	})
	if err != nil {
		t.Fatalf("register pending crypto device: %v", err)
	}

	linkIntent, err := service.CreateCryptoDeviceLinkIntent(context.Background(), authSession.Token, pendingDetails.Device.ID)
	if err != nil {
		t.Fatalf("create crypto link intent: %v", err)
	}
	if linkIntent.Status != CryptoDeviceLinkIntentStatusPending {
		t.Fatalf("ожидался pending link intent, получено %q", linkIntent.Status)
	}

	approvedIntent, approvedDevice, err := service.ApproveCryptoDeviceLinkIntent(
		context.Background(),
		authSession.Token,
		linkIntent.ID,
		firstDetails.Device.ID,
		firstDeviceMaterial.ApprovalProof(
			linkIntent,
			firstDetails.Device.ID,
			pendingDetails.Device.ID,
			pendingDetails.CurrentBundle.BundleDigest,
			linkIntent.CreatedAt,
		),
	)
	if err != nil {
		t.Fatalf("approve crypto link intent: %v", err)
	}
	if approvedIntent.Status != CryptoDeviceLinkIntentStatusApproved {
		t.Fatalf("ожидался approved link intent, получено %q", approvedIntent.Status)
	}
	if approvedDevice.Status != CryptoDeviceStatusActive {
		t.Fatalf("ожидался active linked device после approval, получено %q", approvedDevice.Status)
	}
	if approvedDevice.LinkedByCryptoDeviceID == nil || *approvedDevice.LinkedByCryptoDeviceID != firstDetails.Device.ID {
		t.Fatal("linked_by_crypto_device_id должен указывать на approver device")
	}

	reloaded, err := service.GetCryptoDevice(context.Background(), authSession.Token, pendingDetails.Device.ID)
	if err != nil {
		t.Fatalf("get linked crypto device: %v", err)
	}
	if reloaded.Device.Status != CryptoDeviceStatusActive {
		t.Fatalf("ожидался active status после дочитывания, получено %q", reloaded.Device.Status)
	}
}

func TestCryptoDeviceLinkIntentApprovalRejectsInvalidProofAndSelfApproval(t *testing.T) {
	t.Parallel()

	service := newTestService()
	authSession := mustRegister(t, service, "crypto-proof", "Crypto Proof")
	firstDeviceMaterial := newTestCryptoDeviceMaterial(t)

	firstDetails, err := service.RegisterFirstCryptoDevice(context.Background(), authSession.Token, RegisterCryptoDeviceInput{
		Bundle: firstDeviceMaterial.BundleInput(30),
	})
	if err != nil {
		t.Fatalf("register first crypto device: %v", err)
	}

	pendingDeviceMaterial := newTestCryptoDeviceMaterial(t)
	pendingDetails, err := service.RegisterPendingLinkedCryptoDevice(context.Background(), authSession.Token, RegisterCryptoDeviceInput{
		Bundle: pendingDeviceMaterial.BundleInput(31),
	})
	if err != nil {
		t.Fatalf("register pending crypto device: %v", err)
	}

	linkIntent, err := service.CreateCryptoDeviceLinkIntent(context.Background(), authSession.Token, pendingDetails.Device.ID)
	if err != nil {
		t.Fatalf("create crypto link intent: %v", err)
	}

	if _, _, err := service.ApproveCryptoDeviceLinkIntent(
		context.Background(),
		authSession.Token,
		linkIntent.ID,
		pendingDetails.Device.ID,
		pendingDeviceMaterial.ApprovalProof(
			linkIntent,
			pendingDetails.Device.ID,
			pendingDetails.Device.ID,
			pendingDetails.CurrentBundle.BundleDigest,
			linkIntent.CreatedAt,
		),
	); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидался conflict на self-approval pending device, получено %v", err)
	}

	rogueMaterial := newTestCryptoDeviceMaterial(t)
	if _, _, err := service.ApproveCryptoDeviceLinkIntent(
		context.Background(),
		authSession.Token,
		linkIntent.ID,
		firstDetails.Device.ID,
		rogueMaterial.ApprovalProof(
			linkIntent,
			firstDetails.Device.ID,
			pendingDetails.Device.ID,
			pendingDetails.CurrentBundle.BundleDigest,
			linkIntent.CreatedAt,
		),
	); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидался conflict на approval с неверной подписью, получено %v", err)
	}
}

func TestActiveBundlePublishRequiresSignedProof(t *testing.T) {
	t.Parallel()

	service := newTestService()
	authSession := mustRegister(t, service, "crypto-publish", "Crypto Publish")
	firstDeviceMaterial := newTestCryptoDeviceMaterial(t)

	firstDetails, err := service.RegisterFirstCryptoDevice(context.Background(), authSession.Token, RegisterCryptoDeviceInput{
		Bundle: firstDeviceMaterial.BundleInput(40),
	})
	if err != nil {
		t.Fatalf("register first crypto device: %v", err)
	}

	nextBundle := firstDeviceMaterial.BundleInput(41)
	if _, err := service.PublishCryptoDeviceBundle(context.Background(), authSession.Token, PublishCryptoDeviceBundleInput{
		CryptoDeviceID: firstDetails.Device.ID,
		Bundle:         nextBundle,
	}); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидался conflict без proof-bound publish, получено %v", err)
	}

	challenge, err := service.CreateCryptoDeviceBundlePublishChallenge(context.Background(), authSession.Token, firstDetails.Device.ID)
	if err != nil {
		t.Fatalf("create bundle publish challenge: %v", err)
	}

	updatedDetails, err := service.PublishCryptoDeviceBundle(context.Background(), authSession.Token, PublishCryptoDeviceBundleInput{
		CryptoDeviceID: firstDetails.Device.ID,
		Bundle:         nextBundle,
		Proof:          firstDeviceMaterial.BundlePublishProof(challenge, firstDetails.Device.ID, nextBundle, challenge.CreatedAt),
	})
	if err != nil {
		t.Fatalf("publish active crypto bundle with proof: %v", err)
	}
	if updatedDetails.CurrentBundle == nil || updatedDetails.CurrentBundle.BundleVersion != 2 {
		t.Fatal("ожидался bundle version 2 после signed active publish")
	}
}

func TestActiveBundlePublishRejectsInvalidOrStaleProof(t *testing.T) {
	t.Parallel()

	service := newTestService()
	authSession := mustRegister(t, service, "crypto-publish-proof", "Crypto Publish Proof")
	firstDeviceMaterial := newTestCryptoDeviceMaterial(t)

	firstDetails, err := service.RegisterFirstCryptoDevice(context.Background(), authSession.Token, RegisterCryptoDeviceInput{
		Bundle: firstDeviceMaterial.BundleInput(50),
	})
	if err != nil {
		t.Fatalf("register first crypto device: %v", err)
	}

	challenge, err := service.CreateCryptoDeviceBundlePublishChallenge(context.Background(), authSession.Token, firstDetails.Device.ID)
	if err != nil {
		t.Fatalf("create bundle publish challenge: %v", err)
	}

	rogueMaterial := newTestCryptoDeviceMaterial(t)
	nextBundle := firstDeviceMaterial.BundleInput(51)
	if _, err := service.PublishCryptoDeviceBundle(context.Background(), authSession.Token, PublishCryptoDeviceBundleInput{
		CryptoDeviceID: firstDetails.Device.ID,
		Bundle:         nextBundle,
		Proof:          rogueMaterial.BundlePublishProof(challenge, firstDetails.Device.ID, nextBundle, challenge.CreatedAt),
	}); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидался conflict на publish с неверной подписью, получено %v", err)
	}

	service.now = func() time.Time {
		return challenge.ExpiresAt.Add(time.Second)
	}
	expiredBundle := firstDeviceMaterial.BundleInput(52)
	if _, err := service.PublishCryptoDeviceBundle(context.Background(), authSession.Token, PublishCryptoDeviceBundleInput{
		CryptoDeviceID: firstDetails.Device.ID,
		Bundle:         expiredBundle,
		Proof:          firstDeviceMaterial.BundlePublishProof(challenge, firstDetails.Device.ID, expiredBundle, challenge.CreatedAt),
	}); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидался conflict на publish с протухшим challenge, получено %v", err)
	}
}

func TestCreateBundlePublishChallengeRejectsPendingDevice(t *testing.T) {
	t.Parallel()

	service := newTestService()
	authSession := mustRegister(t, service, "crypto-pending-challenge", "Crypto Pending Challenge")
	firstDeviceMaterial := newTestCryptoDeviceMaterial(t)

	if _, err := service.RegisterFirstCryptoDevice(context.Background(), authSession.Token, RegisterCryptoDeviceInput{
		Bundle: firstDeviceMaterial.BundleInput(60),
	}); err != nil {
		t.Fatalf("register first crypto device: %v", err)
	}

	pendingDeviceMaterial := newTestCryptoDeviceMaterial(t)
	pendingDetails, err := service.RegisterPendingLinkedCryptoDevice(context.Background(), authSession.Token, RegisterCryptoDeviceInput{
		Bundle: pendingDeviceMaterial.BundleInput(61),
	})
	if err != nil {
		t.Fatalf("register pending crypto device: %v", err)
	}

	if _, err := service.CreateCryptoDeviceBundlePublishChallenge(context.Background(), authSession.Token, pendingDetails.Device.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидался conflict на publish challenge для pending_link device, получено %v", err)
	}
}

func TestPublishPendingBundleExpiresExistingLinkIntentAndRevokePersistsState(t *testing.T) {
	t.Parallel()

	service := newTestService()
	authSession := mustRegister(t, service, "crypto-revoke", "Crypto Revoke")
	firstDeviceMaterial := newTestCryptoDeviceMaterial(t)

	firstDetails, err := service.RegisterFirstCryptoDevice(context.Background(), authSession.Token, RegisterCryptoDeviceInput{
		Bundle: firstDeviceMaterial.BundleInput(20),
	})
	if err != nil {
		t.Fatalf("register first crypto device: %v", err)
	}
	if firstDetails.Device.Status != CryptoDeviceStatusActive {
		t.Fatalf("ожидался active first device, получено %q", firstDetails.Device.Status)
	}

	pendingDeviceMaterial := newTestCryptoDeviceMaterial(t)
	pendingDetails, err := service.RegisterPendingLinkedCryptoDevice(context.Background(), authSession.Token, RegisterCryptoDeviceInput{
		Bundle: pendingDeviceMaterial.BundleInput(21),
	})
	if err != nil {
		t.Fatalf("register pending crypto device: %v", err)
	}

	linkIntent, err := service.CreateCryptoDeviceLinkIntent(context.Background(), authSession.Token, pendingDetails.Device.ID)
	if err != nil {
		t.Fatalf("create crypto link intent: %v", err)
	}

	updatedDetails, err := service.PublishCryptoDeviceBundle(context.Background(), authSession.Token, PublishCryptoDeviceBundleInput{
		CryptoDeviceID: pendingDetails.Device.ID,
		Bundle:         pendingDeviceMaterial.BundleInput(22),
	})
	if err != nil {
		t.Fatalf("publish crypto bundle: %v", err)
	}
	if updatedDetails.CurrentBundle == nil || updatedDetails.CurrentBundle.BundleVersion != 2 {
		t.Fatal("ожидался bundle version 2 после publish")
	}

	linkIntents, err := service.ListCryptoDeviceLinkIntents(context.Background(), authSession.Token)
	if err != nil {
		t.Fatalf("list crypto link intents: %v", err)
	}
	if len(linkIntents) != 1 {
		t.Fatalf("ожидался 1 link intent, получено %d", len(linkIntents))
	}
	if linkIntents[0].ID != linkIntent.ID || linkIntents[0].Status != CryptoDeviceLinkIntentStatusExpired {
		t.Fatal("publish нового pending bundle должен переводить старый link intent в expired")
	}

	revokedDevice, err := service.RevokeCryptoDevice(context.Background(), authSession.Token, pendingDetails.Device.ID, strPtr("Пользователь отменил связывание"))
	if err != nil {
		t.Fatalf("revoke crypto device: %v", err)
	}
	if revokedDevice.Status != CryptoDeviceStatusRevoked {
		t.Fatalf("ожидался revoked status, получено %q", revokedDevice.Status)
	}
	if revokedDevice.RevocationReason == nil || *revokedDevice.RevocationReason != "Пользователь отменил связывание" {
		t.Fatal("ожидался сохранённый revocation_reason")
	}
}

type testCryptoDeviceMaterial struct {
	identityPrivateKey *ecdsa.PrivateKey
	identityPublicKey  []byte
}

func newTestCryptoDeviceMaterial(t *testing.T) *testCryptoDeviceMaterial {
	t.Helper()

	identityPrivateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate identity key: %v", err)
	}

	identityPublicKey, err := x509.MarshalPKIXPublicKey(&identityPrivateKey.PublicKey)
	if err != nil {
		t.Fatalf("marshal identity public key: %v", err)
	}

	return &testCryptoDeviceMaterial{
		identityPrivateKey: identityPrivateKey,
		identityPublicKey:  identityPublicKey,
	}
}

func (m *testCryptoDeviceMaterial) BundleInput(sequence int) CryptoDeviceBundleInput {
	signedPrekeyPrivateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		panic(err)
	}
	signedPrekeyPublic, err := x509.MarshalPKIXPublicKey(&signedPrekeyPrivateKey.PublicKey)
	if err != nil {
		panic(err)
	}

	digest := sha256.Sum256(signedPrekeyPublic)
	r, s, err := ecdsa.Sign(rand.Reader, m.identityPrivateKey, digest[:])
	if err != nil {
		panic(err)
	}
	signedPrekeySignature := make([]byte, 64)
	copy(signedPrekeySignature[:32], leftPadBytes(r.Bytes(), 32))
	copy(signedPrekeySignature[32:], leftPadBytes(s.Bytes(), 32))

	bundle := CryptoDeviceBundleInput{
		CryptoSuite:             "webcrypto-p256-foundation-v1",
		IdentityPublicKey:       append([]byte(nil), m.identityPublicKey...),
		SignedPrekeyPublic:      signedPrekeyPublic,
		SignedPrekeyID:          "spk-" + testUUID(sequence),
		SignedPrekeySignature:   signedPrekeySignature,
		OneTimePrekeysTotal:     24,
		OneTimePrekeysAvailable: 24,
	}
	bundleDigest, err := computeCryptoDeviceBundleDigest(bundle)
	if err != nil {
		panic(err)
	}
	bundle.BundleDigest = bundleDigest

	return bundle
}

func (m *testCryptoDeviceMaterial) BundlePublishProof(
	challenge *CryptoDeviceBundlePublishChallenge,
	cryptoDeviceID string,
	bundle CryptoDeviceBundleInput,
	issuedAt time.Time,
) *CryptoDeviceBundlePublishProof {
	payload := CryptoDeviceBundlePublishProofPayload{
		Version:               CryptoDeviceBundlePublishProofVersion,
		CryptoDeviceID:        cryptoDeviceID,
		PreviousBundleVersion: challenge.CurrentBundleVersion,
		PreviousBundleDigest:  append([]byte(nil), challenge.CurrentBundleDigest...),
		NewBundleDigest:       append([]byte(nil), bundle.BundleDigest...),
		PublishChallenge:      append([]byte(nil), challenge.PublishChallenge...),
		ChallengeExpiresAt:    challenge.ExpiresAt,
		IssuedAt:              issuedAt.UTC(),
	}
	digest := sha256.Sum256(buildCryptoDeviceBundlePublishSigningMessage(payload))
	r, s, err := ecdsa.Sign(rand.Reader, m.identityPrivateKey, digest[:])
	if err != nil {
		panic(err)
	}

	signature := make([]byte, 64)
	copy(signature[:32], leftPadBytes(r.Bytes(), 32))
	copy(signature[32:], leftPadBytes(s.Bytes(), 32))

	return &CryptoDeviceBundlePublishProof{
		Payload:   payload,
		Signature: signature,
	}
}

func (m *testCryptoDeviceMaterial) ApprovalProof(
	linkIntent *CryptoDeviceLinkIntent,
	approverCryptoDeviceID string,
	pendingCryptoDeviceID string,
	pendingBundleDigest []byte,
	issuedAt time.Time,
) CryptoDeviceLinkApprovalProof {
	payload := CryptoDeviceLinkApprovalPayload{
		Version:                CryptoDeviceLinkApprovalProofVersion,
		LinkIntentID:           linkIntent.ID,
		ApproverCryptoDeviceID: approverCryptoDeviceID,
		PendingCryptoDeviceID:  pendingCryptoDeviceID,
		PendingBundleDigest:    append([]byte(nil), pendingBundleDigest...),
		ApprovalChallenge:      append([]byte(nil), linkIntent.ApprovalChallenge...),
		ChallengeExpiresAt:     linkIntent.ExpiresAt,
		IssuedAt:               issuedAt.UTC(),
	}
	digest := sha256.Sum256(buildCryptoDeviceLinkApprovalSigningMessage(payload))
	r, s, err := ecdsa.Sign(rand.Reader, m.identityPrivateKey, digest[:])
	if err != nil {
		panic(err)
	}

	signature := make([]byte, 64)
	copy(signature[:32], leftPadBytes(r.Bytes(), 32))
	copy(signature[32:], leftPadBytes(s.Bytes(), 32))

	return CryptoDeviceLinkApprovalProof{
		Payload:   payload,
		Signature: signature,
	}
}

func leftPadBytes(value []byte, size int) []byte {
	if len(value) >= size {
		return value[len(value)-size:]
	}

	padded := make([]byte, size)
	copy(padded[size-len(value):], value)
	return padded
}
