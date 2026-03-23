package realtime

import rtcv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1"

const (
	EventTypeRTCCallUpdated        = "rtc.call.updated"
	EventTypeRTCParticipantUpdated = "rtc.participant.updated"
	EventTypeRTCSignalReceived     = "rtc.signal.received"
)

type rtcCallUpdatedPayload struct {
	Call *rtcCallWire `json:"call,omitempty"`
}

type rtcParticipantUpdatedPayload struct {
	CallID      string              `json:"callId"`
	Participant *rtcParticipantWire `json:"participant,omitempty"`
}

type rtcSignalReceivedPayload struct {
	Signal *rtcSignalWire `json:"signal,omitempty"`
}

type rtcScopeWire struct {
	Type         string `json:"type"`
	DirectChatID string `json:"directChatId,omitempty"`
	GroupID      string `json:"groupId,omitempty"`
}

type rtcCallWire struct {
	ID                     string        `json:"id"`
	Scope                  *rtcScopeWire `json:"scope,omitempty"`
	CreatedByUserID        string        `json:"createdByUserId"`
	Status                 string        `json:"status"`
	ActiveParticipantCount uint32        `json:"activeParticipantCount"`
	CreatedAt              string        `json:"createdAt"`
	UpdatedAt              string        `json:"updatedAt"`
	StartedAt              string        `json:"startedAt"`
	EndedAt                string        `json:"endedAt,omitempty"`
	EndedByUserID          string        `json:"endedByUserId,omitempty"`
	EndReason              string        `json:"endReason,omitempty"`
}

type rtcParticipantWire struct {
	ID           string `json:"id"`
	CallID       string `json:"callId"`
	UserID       string `json:"userId"`
	State        string `json:"state"`
	JoinedAt     string `json:"joinedAt"`
	LeftAt       string `json:"leftAt,omitempty"`
	UpdatedAt    string `json:"updatedAt"`
	LastSignalAt string `json:"lastSignalAt,omitempty"`
}

type rtcSignalWire struct {
	CallID       string `json:"callId"`
	FromUserID   string `json:"fromUserId"`
	TargetUserID string `json:"targetUserId"`
	Type         string `json:"type"`
	Payload      []byte `json:"payload"`
	CreatedAt    string `json:"createdAt"`
}

func NewRTCCallUpdatedEnvelope(call *rtcv1.Call) Envelope {
	return newEnvelope(EventTypeRTCCallUpdated, rtcCallUpdatedPayload{
		Call: toRTCCallWire(call),
	})
}

func NewRTCParticipantUpdatedEnvelope(callID string, participant *rtcv1.CallParticipant) Envelope {
	return newEnvelope(EventTypeRTCParticipantUpdated, rtcParticipantUpdatedPayload{
		CallID:      callID,
		Participant: toRTCParticipantWire(participant),
	})
}

func NewRTCSignalReceivedEnvelope(signal *rtcv1.SignalEnvelope) Envelope {
	return newEnvelope(EventTypeRTCSignalReceived, rtcSignalReceivedPayload{
		Signal: toRTCSignalWire(signal),
	})
}

func toRTCCallWire(call *rtcv1.Call) *rtcCallWire {
	if call == nil {
		return nil
	}

	return &rtcCallWire{
		ID:                     call.Id,
		Scope:                  toRTCScopeWire(call.Scope),
		CreatedByUserID:        call.CreatedByUserId,
		Status:                 call.Status.String(),
		ActiveParticipantCount: call.ActiveParticipantCount,
		CreatedAt:              formatProtoTimestamp(call.CreatedAt),
		UpdatedAt:              formatProtoTimestamp(call.UpdatedAt),
		StartedAt:              formatProtoTimestamp(call.StartedAt),
		EndedAt:                formatProtoTimestamp(call.EndedAt),
		EndedByUserID:          call.EndedByUserId,
		EndReason:              call.EndReason.String(),
	}
}

func toRTCScopeWire(scope *rtcv1.ConversationScope) *rtcScopeWire {
	if scope == nil {
		return nil
	}

	return &rtcScopeWire{
		Type:         scope.Type.String(),
		DirectChatID: scope.DirectChatId,
		GroupID:      scope.GroupId,
	}
}

func toRTCParticipantWire(participant *rtcv1.CallParticipant) *rtcParticipantWire {
	if participant == nil {
		return nil
	}

	return &rtcParticipantWire{
		ID:           participant.Id,
		CallID:       participant.CallId,
		UserID:       participant.UserId,
		State:        participant.State.String(),
		JoinedAt:     formatProtoTimestamp(participant.JoinedAt),
		LeftAt:       formatProtoTimestamp(participant.LeftAt),
		UpdatedAt:    formatProtoTimestamp(participant.UpdatedAt),
		LastSignalAt: formatProtoTimestamp(participant.LastSignalAt),
	}
}

func toRTCSignalWire(signal *rtcv1.SignalEnvelope) *rtcSignalWire {
	if signal == nil {
		return nil
	}

	return &rtcSignalWire{
		CallID:       signal.CallId,
		FromUserID:   signal.FromUserId,
		TargetUserID: signal.TargetUserId,
		Type:         signal.Type.String(),
		Payload:      append([]byte(nil), signal.Payload...),
		CreatedAt:    formatProtoTimestamp(signal.CreatedAt),
	}
}
