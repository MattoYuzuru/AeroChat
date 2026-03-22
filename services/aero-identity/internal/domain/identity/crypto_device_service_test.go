package identity

import (
	"context"
	"errors"
	"testing"
)

func TestRegisterFirstAndPendingCryptoDevices(t *testing.T) {
	t.Parallel()

	service := newTestService()
	authSession := mustRegister(t, service, "crypto-owner", "Crypto Owner")

	firstDetails, err := service.RegisterFirstCryptoDevice(context.Background(), authSession.Token, RegisterCryptoDeviceInput{
		DeviceLabel: strPtr("Основной крипто-девайс"),
		Bundle:      testCryptoBundleInput(1),
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
		Bundle: testCryptoBundleInput(2),
	}); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка повторного first-device bootstrap, получено %v", err)
	}

	pendingDetails, err := service.RegisterPendingLinkedCryptoDevice(context.Background(), authSession.Token, RegisterCryptoDeviceInput{
		DeviceLabel: strPtr("Связываемое устройство"),
		Bundle:      testCryptoBundleInput(3),
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

	firstDetails, err := service.RegisterFirstCryptoDevice(context.Background(), authSession.Token, RegisterCryptoDeviceInput{
		Bundle: testCryptoBundleInput(10),
	})
	if err != nil {
		t.Fatalf("register first crypto device: %v", err)
	}

	pendingDetails, err := service.RegisterPendingLinkedCryptoDevice(context.Background(), authSession.Token, RegisterCryptoDeviceInput{
		Bundle: testCryptoBundleInput(11),
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

func TestPublishPendingBundleExpiresExistingLinkIntentAndRevokePersistsState(t *testing.T) {
	t.Parallel()

	service := newTestService()
	authSession := mustRegister(t, service, "crypto-revoke", "Crypto Revoke")

	firstDetails, err := service.RegisterFirstCryptoDevice(context.Background(), authSession.Token, RegisterCryptoDeviceInput{
		Bundle: testCryptoBundleInput(20),
	})
	if err != nil {
		t.Fatalf("register first crypto device: %v", err)
	}
	if firstDetails.Device.Status != CryptoDeviceStatusActive {
		t.Fatalf("ожидался active first device, получено %q", firstDetails.Device.Status)
	}

	pendingDetails, err := service.RegisterPendingLinkedCryptoDevice(context.Background(), authSession.Token, RegisterCryptoDeviceInput{
		Bundle: testCryptoBundleInput(21),
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
		Bundle:         testCryptoBundleInput(22),
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

func testCryptoBundleInput(sequence int) CryptoDeviceBundleInput {
	return CryptoDeviceBundleInput{
		CryptoSuite:             "signal-pqxdh-v1",
		IdentityPublicKey:       []byte("identity-public-" + testUUID(sequence)),
		SignedPrekeyPublic:      []byte("signed-prekey-public-" + testUUID(sequence)),
		SignedPrekeyID:          "spk-" + testUUID(sequence),
		SignedPrekeySignature:   []byte("signed-prekey-signature-" + testUUID(sequence)),
		KEMPublicKey:            []byte("kem-public-" + testUUID(sequence)),
		KEMKeyID:                strPtr("kem-" + testUUID(sequence)),
		KEMSignature:            []byte("kem-signature-" + testUUID(sequence)),
		OneTimePrekeysTotal:     24,
		OneTimePrekeysAvailable: 24,
		BundleDigest:            []byte("bundle-digest-" + testUUID(sequence)),
	}
}
