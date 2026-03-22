package realtime

import chatv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1"

type EncryptedGroupMessageV1DeliveredPayload struct {
	Envelope *encryptedGroupMessageV1EnvelopeWire `json:"envelope,omitempty"`
}

type encryptedGroupMessageV1EnvelopeWire struct {
	MessageID            string                               `json:"messageId"`
	GroupID              string                               `json:"groupId"`
	ThreadID             string                               `json:"threadId"`
	MLSGroupID           string                               `json:"mlsGroupId"`
	RosterVersion        uint64                               `json:"rosterVersion"`
	SenderUserID         string                               `json:"senderUserId"`
	SenderCryptoDeviceID string                               `json:"senderCryptoDeviceId"`
	OperationKind        string                               `json:"operationKind"`
	TargetMessageID      string                               `json:"targetMessageId,omitempty"`
	Revision             uint32                               `json:"revision"`
	Ciphertext           []byte                               `json:"ciphertext"`
	CiphertextSizeBytes  uint64                               `json:"ciphertextSizeBytes"`
	CreatedAt            string                               `json:"createdAt"`
	StoredAt             string                               `json:"storedAt"`
	ViewerDelivery       *encryptedGroupMessageV1DeliveryWire `json:"viewerDelivery,omitempty"`
}

type encryptedGroupMessageV1DeliveryWire struct {
	RecipientUserID         string `json:"recipientUserId"`
	RecipientCryptoDeviceID string `json:"recipientCryptoDeviceId"`
	StoredAt                string `json:"storedAt"`
}

func NewEncryptedGroupMessageV1DeliveredEnvelope(
	envelope *chatv1.EncryptedGroupStoredEnvelope,
	ciphertext []byte,
	delivery *chatv1.EncryptedGroupMessageDelivery,
) Envelope {
	return newEnvelope(EncryptedGroupMessageV1EventTypeDelivered, EncryptedGroupMessageV1DeliveredPayload{
		Envelope: toEncryptedGroupMessageV1EnvelopeWire(envelope, ciphertext, delivery),
	})
}

func toEncryptedGroupMessageV1EnvelopeWire(
	envelope *chatv1.EncryptedGroupStoredEnvelope,
	ciphertext []byte,
	delivery *chatv1.EncryptedGroupMessageDelivery,
) *encryptedGroupMessageV1EnvelopeWire {
	if envelope == nil || delivery == nil {
		return nil
	}

	return &encryptedGroupMessageV1EnvelopeWire{
		MessageID:            envelope.GetMessageId(),
		GroupID:              envelope.GetGroupId(),
		ThreadID:             envelope.GetThreadId(),
		MLSGroupID:           envelope.GetMlsGroupId(),
		RosterVersion:        envelope.GetRosterVersion(),
		SenderUserID:         envelope.GetSenderUserId(),
		SenderCryptoDeviceID: envelope.GetSenderCryptoDeviceId(),
		OperationKind:        envelope.GetOperationKind().String(),
		TargetMessageID:      envelope.GetTargetMessageId(),
		Revision:             envelope.GetRevision(),
		Ciphertext:           append([]byte(nil), ciphertext...),
		CiphertextSizeBytes:  uint64(len(ciphertext)),
		CreatedAt:            formatProtoTimestamp(envelope.GetCreatedAt()),
		StoredAt:             formatProtoTimestamp(envelope.GetStoredAt()),
		ViewerDelivery:       toEncryptedGroupMessageV1DeliveryWire(delivery),
	}
}

func toEncryptedGroupMessageV1DeliveryWire(delivery *chatv1.EncryptedGroupMessageDelivery) *encryptedGroupMessageV1DeliveryWire {
	if delivery == nil {
		return nil
	}

	return &encryptedGroupMessageV1DeliveryWire{
		RecipientUserID:         delivery.GetRecipientUserId(),
		RecipientCryptoDeviceID: delivery.GetRecipientCryptoDeviceId(),
		StoredAt:                formatProtoTimestamp(delivery.GetStoredAt()),
	}
}
