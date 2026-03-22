package realtime

import (
	"testing"
	"time"

	chatv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestNewEncryptedGroupMessageV1DeliveredEnvelope(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 22, 12, 0, 0, 0, time.UTC)
	envelope := NewEncryptedGroupMessageV1DeliveredEnvelope(
		&chatv1.EncryptedGroupStoredEnvelope{
			MessageId:            "message-1",
			GroupId:              "group-1",
			ThreadId:             "thread-1",
			MlsGroupId:           "mls-1",
			RosterVersion:        3,
			SenderUserId:         "user-1",
			SenderCryptoDeviceId: "device-1",
			OperationKind:        chatv1.EncryptedGroupMessageOperationKind_ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_CONTENT,
			Revision:             1,
			CreatedAt:            timestamppb.New(now),
			StoredAt:             timestamppb.New(now),
		},
		[]byte("opaque-group-ciphertext"),
		&chatv1.EncryptedGroupMessageDelivery{
			RecipientUserId:         "user-2",
			RecipientCryptoDeviceId: "device-2",
			StoredAt:                timestamppb.New(now),
		},
	)

	if envelope.Type != EncryptedGroupMessageV1EventTypeDelivered {
		t.Fatalf("ожидался event type %q, получен %q", EncryptedGroupMessageV1EventTypeDelivered, envelope.Type)
	}

	payload, ok := envelope.Payload.(EncryptedGroupMessageV1DeliveredPayload)
	if !ok {
		t.Fatalf("ожидался EncryptedGroupMessageV1DeliveredPayload, получено %T", envelope.Payload)
	}
	if payload.Envelope == nil {
		t.Fatal("ожидался opaque encrypted group envelope в payload")
	}
	if payload.Envelope.GroupID != "group-1" {
		t.Fatalf("ожидался group id %q, получен %q", "group-1", payload.Envelope.GroupID)
	}
	if payload.Envelope.ViewerDelivery == nil || payload.Envelope.ViewerDelivery.RecipientCryptoDeviceID != "device-2" {
		t.Fatalf("ожидался viewer delivery для device-2, получено %+v", payload.Envelope.ViewerDelivery)
	}
	if string(payload.Envelope.Ciphertext) != "opaque-group-ciphertext" {
		t.Fatalf("ожидался opaque ciphertext, получено %q", string(payload.Envelope.Ciphertext))
	}
	if payload.Envelope.OperationKind != "ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_CONTENT" {
		t.Fatalf("ожидался string enum operation kind, получено %q", payload.Envelope.OperationKind)
	}
}
