package realtime

import (
	identityv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1"
)

const (
	EventTypePeopleUpdated = "people.updated"

	PeopleReasonIncomingRequestUpsert = "incoming_request_upsert"
	PeopleReasonIncomingRequestRemove = "incoming_request_remove"
	PeopleReasonOutgoingRequestUpsert = "outgoing_request_upsert"
	PeopleReasonOutgoingRequestRemove = "outgoing_request_remove"
	PeopleReasonFriendUpsert          = "friend_upsert"
	PeopleReasonFriendRemove          = "friend_remove"
	PeopleReasonRelationshipCleared   = "relationship_cleared"
)

type PeopleUpdatedPayload struct {
	Reason  string             `json:"reason"`
	Login   string             `json:"login,omitempty"`
	Request *friendRequestWire `json:"request,omitempty"`
	Friend  *friendWire        `json:"friend,omitempty"`
}

type profileWire struct {
	ID                      string  `json:"id"`
	Login                   string  `json:"login"`
	Nickname                string  `json:"nickname"`
	AvatarURL               *string `json:"avatarUrl,omitempty"`
	Bio                     *string `json:"bio,omitempty"`
	Timezone                *string `json:"timezone,omitempty"`
	ProfileAccent           *string `json:"profileAccent,omitempty"`
	StatusText              *string `json:"statusText,omitempty"`
	Birthday                *string `json:"birthday,omitempty"`
	Country                 *string `json:"country,omitempty"`
	City                    *string `json:"city,omitempty"`
	ReadReceiptsEnabled     bool    `json:"readReceiptsEnabled"`
	PresenceEnabled         bool    `json:"presenceEnabled"`
	TypingVisibilityEnabled bool    `json:"typingVisibilityEnabled"`
	KeyBackupStatus         string  `json:"keyBackupStatus"`
	CreatedAt               string  `json:"createdAt"`
	UpdatedAt               string  `json:"updatedAt"`
}

type friendRequestWire struct {
	Profile     *profileWire `json:"profile,omitempty"`
	RequestedAt string       `json:"requestedAt"`
}

type friendWire struct {
	Profile      *profileWire `json:"profile,omitempty"`
	FriendsSince string       `json:"friendsSince"`
}

func NewPeopleRequestUpdatedEnvelope(reason string, request *identityv1.FriendRequest) Envelope {
	payload := PeopleUpdatedPayload{
		Reason:  reason,
		Request: toFriendRequestWire(request),
	}
	if request != nil && request.GetProfile().GetLogin() != "" {
		payload.Login = request.GetProfile().GetLogin()
	}

	return newEnvelope(EventTypePeopleUpdated, payload)
}

func NewPeopleFriendUpdatedEnvelope(reason string, friend *identityv1.Friend) Envelope {
	payload := PeopleUpdatedPayload{
		Reason: reason,
		Friend: toFriendWire(friend),
	}
	if friend != nil && friend.GetProfile().GetLogin() != "" {
		payload.Login = friend.GetProfile().GetLogin()
	}

	return newEnvelope(EventTypePeopleUpdated, payload)
}

func NewPeopleLoginEnvelope(reason string, login string) Envelope {
	return newEnvelope(EventTypePeopleUpdated, PeopleUpdatedPayload{
		Reason: reason,
		Login:  login,
	})
}

func toFriendRequestWire(request *identityv1.FriendRequest) *friendRequestWire {
	if request == nil {
		return nil
	}

	return &friendRequestWire{
		Profile:     toProfileWire(request.GetProfile()),
		RequestedAt: formatProtoTimestamp(request.GetRequestedAt()),
	}
}

func toFriendWire(friend *identityv1.Friend) *friendWire {
	if friend == nil {
		return nil
	}

	return &friendWire{
		Profile:      toProfileWire(friend.GetProfile()),
		FriendsSince: formatProtoTimestamp(friend.GetFriendsSince()),
	}
}

func toProfileWire(profile *identityv1.Profile) *profileWire {
	if profile == nil {
		return nil
	}

	return &profileWire{
		ID:                      profile.GetId(),
		Login:                   profile.GetLogin(),
		Nickname:                profile.GetNickname(),
		AvatarURL:               profile.AvatarUrl,
		Bio:                     profile.Bio,
		Timezone:                profile.Timezone,
		ProfileAccent:           profile.ProfileAccent,
		StatusText:              profile.StatusText,
		Birthday:                profile.Birthday,
		Country:                 profile.Country,
		City:                    profile.City,
		ReadReceiptsEnabled:     profile.GetReadReceiptsEnabled(),
		PresenceEnabled:         profile.GetPresenceEnabled(),
		TypingVisibilityEnabled: profile.GetTypingVisibilityEnabled(),
		KeyBackupStatus:         profile.GetKeyBackupStatus().String(),
		CreatedAt:               formatProtoTimestamp(profile.GetCreatedAt()),
		UpdatedAt:               formatProtoTimestamp(profile.GetUpdatedAt()),
	}
}
