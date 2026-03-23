package realtime

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"
)

const (
	Path                  = "/realtime"
	Protocol              = "aerochat.realtime.v1"
	authProtocolPrefix    = "aerochat.auth."
	EventTypeReady        = "connection.ready"
	EventTypeKeepalive    = "connection.keepalive"
	defaultOutboundBuffer = 16
)

var readyCapabilities = []string{
	"direct_chats",
	"encrypted_direct_message_v2",
	"encrypted_group_message_v1",
	"groups",
	"people",
	"presence",
	"rtc_control",
	"crypto_device_binding",
}

// Envelope задаёт минимальный контракт realtime-события для клиента.
type Envelope struct {
	ID       string    `json:"id"`
	Type     string    `json:"type"`
	IssuedAt time.Time `json:"issuedAt"`
	Payload  any       `json:"payload,omitempty"`
}

// ReadyPayload подтверждает успешную аутентификацию и запуск сессии.
type ReadyPayload struct {
	ConnectionID string   `json:"connectionId"`
	UserID       string   `json:"userId"`
	Capabilities []string `json:"capabilities"`
}

func newEnvelope(eventType string, payload any) Envelope {
	return Envelope{
		ID:       newEnvelopeID(),
		Type:     eventType,
		IssuedAt: time.Now().UTC(),
		Payload:  payload,
	}
}

func newReadyEnvelope(connectionID string, userID string) Envelope {
	capabilities := make([]string, 0, len(readyCapabilities))
	capabilities = append(capabilities, readyCapabilities...)

	return newEnvelope(EventTypeReady, ReadyPayload{
		ConnectionID: connectionID,
		UserID:       userID,
		Capabilities: capabilities,
	})
}

func newEnvelopeID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("evt-%d", time.Now().UTC().UnixNano())
	}

	return "evt-" + hex.EncodeToString(buf)
}
