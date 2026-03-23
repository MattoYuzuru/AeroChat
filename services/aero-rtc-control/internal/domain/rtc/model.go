package rtc

import "time"

const (
	ScopeTypeDirect               = "direct"
	ScopeTypeGroup                = "group"
	CallStatusActive              = "active"
	CallStatusEnded               = "ended"
	CallEndReasonManual           = "manual"
	CallEndReasonLastParticipant  = "last_participant_left"
	ParticipantStateActive        = "active"
	ParticipantStateLeft          = "left"
	GroupRoleOwner                = "owner"
	GroupRoleAdmin                = "admin"
	GroupRoleMember               = "member"
	GroupRoleReader               = "reader"
	SignalTypeOffer               = "offer"
	SignalTypeAnswer              = "answer"
	SignalTypeICECandidate        = "ice_candidate"
	maxSignalRelayPayloadBytes    = 16 * 1024
	defaultDownstreamTouchTimeout = 5 * time.Second
)

type ConversationScope struct {
	Type         string
	DirectChatID string
	GroupID      string
}

type Call struct {
	ID                     string
	Scope                  ConversationScope
	CreatedByUserID        string
	Status                 string
	ActiveParticipantCount uint32
	CreatedAt              time.Time
	UpdatedAt              time.Time
	StartedAt              time.Time
	EndedAt                *time.Time
	EndedByUserID          *string
	EndReason              string
}

type CallParticipant struct {
	ID           string
	CallID       string
	UserID       string
	State        string
	JoinedAt     time.Time
	LeftAt       *time.Time
	UpdatedAt    time.Time
	LastSignalAt *time.Time
}

type ActiveParticipation struct {
	Call        Call
	Participant CallParticipant
}

type SignalEnvelope struct {
	CallID       string
	FromUserID   string
	TargetUserID string
	Type         string
	Payload      []byte
	CreatedAt    time.Time
}

type AuthenticatedUser struct {
	ID string
}

type ScopeAccess struct {
	Scope     ConversationScope
	GroupRole string
}
