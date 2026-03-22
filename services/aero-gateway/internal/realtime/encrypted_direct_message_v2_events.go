package realtime

import chatv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1"

type EncryptedDirectMessageV2DeliveredPayload struct {
	Envelope *encryptedDirectMessageV2EnvelopeWire `json:"envelope,omitempty"`
}

type encryptedDirectMessageV2EnvelopeWire struct {
	MessageID            string                                `json:"messageId"`
	ChatID               string                                `json:"chatId"`
	SenderUserID         string                                `json:"senderUserId"`
	SenderCryptoDeviceID string                                `json:"senderCryptoDeviceId"`
	OperationKind        string                                `json:"operationKind"`
	TargetMessageID      string                                `json:"targetMessageId,omitempty"`
	Revision             uint32                                `json:"revision"`
	CreatedAt            string                                `json:"createdAt"`
	StoredAt             string                                `json:"storedAt"`
	ViewerDelivery       *encryptedDirectMessageV2DeliveryWire `json:"viewerDelivery,omitempty"`
}

type encryptedDirectMessageV2DeliveryWire struct {
	RecipientCryptoDeviceID string `json:"recipientCryptoDeviceId"`
	TransportHeader         []byte `json:"transportHeader"`
	Ciphertext              []byte `json:"ciphertext"`
	CiphertextSizeBytes     uint64 `json:"ciphertextSizeBytes"`
	StoredAt                string `json:"storedAt"`
}

func NewEncryptedDirectMessageV2DeliveredEnvelope(
	envelope *chatv1.EncryptedDirectMessageV2StoredEnvelope,
	delivery *chatv1.EncryptedDirectMessageV2DeliveryInput,
) Envelope {
	return newEnvelope(EncryptedDirectMessageV2EventTypeDelivered, EncryptedDirectMessageV2DeliveredPayload{
		Envelope: toEncryptedDirectMessageV2EnvelopeWire(envelope, delivery),
	})
}

func toEncryptedDirectMessageV2EnvelopeWire(
	envelope *chatv1.EncryptedDirectMessageV2StoredEnvelope,
	delivery *chatv1.EncryptedDirectMessageV2DeliveryInput,
) *encryptedDirectMessageV2EnvelopeWire {
	if envelope == nil || delivery == nil {
		return nil
	}

	return &encryptedDirectMessageV2EnvelopeWire{
		MessageID:            envelope.GetMessageId(),
		ChatID:               envelope.GetChatId(),
		SenderUserID:         envelope.GetSenderUserId(),
		SenderCryptoDeviceID: envelope.GetSenderCryptoDeviceId(),
		OperationKind:        envelope.GetOperationKind().String(),
		TargetMessageID:      envelope.GetTargetMessageId(),
		Revision:             envelope.GetRevision(),
		CreatedAt:            formatProtoTimestamp(envelope.GetCreatedAt()),
		StoredAt:             formatProtoTimestamp(envelope.GetStoredAt()),
		ViewerDelivery:       toEncryptedDirectMessageV2DeliveryWire(delivery, formatProtoTimestamp(envelope.GetStoredAt())),
	}
}

func toEncryptedDirectMessageV2DeliveryWire(
	delivery *chatv1.EncryptedDirectMessageV2DeliveryInput,
	storedAt string,
) *encryptedDirectMessageV2DeliveryWire {
	if delivery == nil {
		return nil
	}

	return &encryptedDirectMessageV2DeliveryWire{
		RecipientCryptoDeviceID: delivery.GetRecipientCryptoDeviceId(),
		TransportHeader:         append([]byte(nil), delivery.GetTransportHeader()...),
		Ciphertext:              append([]byte(nil), delivery.GetCiphertext()...),
		CiphertextSizeBytes:     uint64(len(delivery.GetCiphertext())),
		StoredAt:                storedAt,
	}
}
