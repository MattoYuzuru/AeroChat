package realtime

import (
	"encoding/json"
	"fmt"
	"strings"
)

const (
	ClientEventTypeBindCryptoDevice              = "connection.bind_crypto_device"
	EventTypeCryptoDeviceBound                   = "connection.crypto_device.bound"
	EventTypeCryptoDeviceBindRejected            = "connection.crypto_device.bind_rejected"
	EncryptedDirectMessageV2EventTypeDelivered   = "encrypted_direct_message_v2.delivery"
	cryptoDeviceBindRejectReasonInvalidPayload   = "invalid_payload"
	cryptoDeviceBindRejectReasonPermissionDenied = "permission_denied"
	cryptoDeviceBindRejectReasonUnavailable      = "unavailable"
	cryptoDeviceBindRejectReasonRejected         = "rejected"
)

type inboundEnvelope struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type bindCryptoDevicePayload struct {
	CryptoDeviceID string `json:"cryptoDeviceId"`
}

type CryptoDeviceBoundPayload struct {
	ConnectionID   string `json:"connectionId"`
	UserID         string `json:"userId"`
	CryptoDeviceID string `json:"cryptoDeviceId"`
}

type CryptoDeviceBindRejectedPayload struct {
	ConnectionID   string `json:"connectionId"`
	CryptoDeviceID string `json:"cryptoDeviceId,omitempty"`
	Reason         string `json:"reason"`
	Message        string `json:"message"`
}

func parseBindCryptoDevicePayload(raw json.RawMessage) (bindCryptoDevicePayload, error) {
	var payload bindCryptoDevicePayload
	if len(raw) == 0 {
		return payload, fmt.Errorf("bind payload is required")
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return payload, fmt.Errorf("decode bind payload: %w", err)
	}
	payload.CryptoDeviceID = strings.TrimSpace(payload.CryptoDeviceID)
	if payload.CryptoDeviceID == "" {
		return payload, fmt.Errorf("crypto_device_id is required")
	}

	return payload, nil
}

func newCryptoDeviceBoundEnvelope(connectionID string, userID string, cryptoDeviceID string) Envelope {
	return newEnvelope(EventTypeCryptoDeviceBound, CryptoDeviceBoundPayload{
		ConnectionID:   connectionID,
		UserID:         userID,
		CryptoDeviceID: cryptoDeviceID,
	})
}

func newCryptoDeviceBindRejectedEnvelope(connectionID string, cryptoDeviceID string, reason string, message string) Envelope {
	return newEnvelope(EventTypeCryptoDeviceBindRejected, CryptoDeviceBindRejectedPayload{
		ConnectionID:   connectionID,
		CryptoDeviceID: strings.TrimSpace(cryptoDeviceID),
		Reason:         strings.TrimSpace(reason),
		Message:        strings.TrimSpace(message),
	})
}
