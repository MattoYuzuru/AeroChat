package realtime

import (
	chatv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1"
)

const (
	EventTypeGroupMessageUpdated       = "group.message.updated"
	EventTypeGroupMembershipUpdated    = "group.membership.updated"
	EventTypeGroupRoleUpdated          = "group.role.updated"
	EventTypeGroupOwnershipTransferred = "group.ownership.transferred"
	GroupMessageReasonCreated          = "message_created"
	GroupMembershipReasonJoined        = "member_joined"
	GroupMembershipReasonRemoved       = "member_removed"
	GroupMembershipReasonLeft          = "member_left"
)

// GroupMessageUpdatedPayload доставляет recipient-aware snapshot группы и thread вместе с сообщением.
type GroupMessageUpdatedPayload struct {
	Reason  string            `json:"reason"`
	Group   *groupWire        `json:"group,omitempty"`
	Thread  *groupThreadWire  `json:"thread,omitempty"`
	Message *groupMessageWire `json:"message,omitempty"`
}

// GroupMembershipUpdatedPayload доставляет bounded membership update для конкретного пользователя.
type GroupMembershipUpdatedPayload struct {
	Reason         string           `json:"reason"`
	GroupID        string           `json:"groupId"`
	Group          *groupWire       `json:"group,omitempty"`
	Thread         *groupThreadWire `json:"thread,omitempty"`
	AffectedUserID string           `json:"affectedUserId"`
	Member         *groupMemberWire `json:"member,omitempty"`
	SelfMember     *groupMemberWire `json:"selfMember,omitempty"`
}

// GroupRoleUpdatedPayload доставляет recipient-aware role update для roster и shell.
type GroupRoleUpdatedPayload struct {
	GroupID      string           `json:"groupId"`
	Group        *groupWire       `json:"group,omitempty"`
	Thread       *groupThreadWire `json:"thread,omitempty"`
	Member       *groupMemberWire `json:"member,omitempty"`
	SelfMember   *groupMemberWire `json:"selfMember,omitempty"`
	PreviousRole string           `json:"previousRole"`
}

// GroupOwnershipTransferredPayload доставляет две role changes в одной явной ownership операции.
type GroupOwnershipTransferredPayload struct {
	GroupID             string           `json:"groupId"`
	Group               *groupWire       `json:"group,omitempty"`
	Thread              *groupThreadWire `json:"thread,omitempty"`
	OwnerMember         *groupMemberWire `json:"ownerMember,omitempty"`
	PreviousOwnerMember *groupMemberWire `json:"previousOwnerMember,omitempty"`
	SelfMember          *groupMemberWire `json:"selfMember,omitempty"`
}

type groupWire struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	SelfRole    string `json:"selfRole"`
	MemberCount uint32 `json:"memberCount"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type groupThreadWire struct {
	ID              string `json:"id"`
	GroupID         string `json:"groupId"`
	ThreadKey       string `json:"threadKey"`
	CanSendMessages bool   `json:"canSendMessages"`
	CreatedAt       string `json:"createdAt"`
	UpdatedAt       string `json:"updatedAt"`
}

type groupMemberWire struct {
	User     *chatUserWire `json:"user,omitempty"`
	Role     string        `json:"role"`
	JoinedAt string        `json:"joinedAt"`
}

type groupMessageWire struct {
	ID           string                  `json:"id"`
	GroupID      string                  `json:"groupId"`
	ThreadID     string                  `json:"threadId"`
	SenderUserID string                  `json:"senderUserId"`
	Kind         string                  `json:"kind"`
	Text         *textMessageContentWire `json:"text,omitempty"`
	CreatedAt    string                  `json:"createdAt"`
	UpdatedAt    string                  `json:"updatedAt"`
}

func NewGroupMessageUpdatedEnvelope(
	reason string,
	group *chatv1.Group,
	thread *chatv1.GroupChatThread,
	message *chatv1.GroupMessage,
) Envelope {
	return newEnvelope(EventTypeGroupMessageUpdated, GroupMessageUpdatedPayload{
		Reason:  reason,
		Group:   toGroupWire(group),
		Thread:  toGroupThreadWire(thread),
		Message: toGroupMessageWire(message),
	})
}

func NewGroupMembershipUpdatedEnvelope(
	reason string,
	groupID string,
	group *chatv1.Group,
	thread *chatv1.GroupChatThread,
	affectedUserID string,
	member *chatv1.GroupMember,
	selfMember *chatv1.GroupMember,
) Envelope {
	return newEnvelope(EventTypeGroupMembershipUpdated, GroupMembershipUpdatedPayload{
		Reason:         reason,
		GroupID:        groupID,
		Group:          toGroupWire(group),
		Thread:         toGroupThreadWire(thread),
		AffectedUserID: affectedUserID,
		Member:         toGroupMemberWire(member),
		SelfMember:     toGroupMemberWire(selfMember),
	})
}

func NewGroupRoleUpdatedEnvelope(
	groupID string,
	group *chatv1.Group,
	thread *chatv1.GroupChatThread,
	member *chatv1.GroupMember,
	selfMember *chatv1.GroupMember,
	previousRole string,
) Envelope {
	return newEnvelope(EventTypeGroupRoleUpdated, GroupRoleUpdatedPayload{
		GroupID:      groupID,
		Group:        toGroupWire(group),
		Thread:       toGroupThreadWire(thread),
		Member:       toGroupMemberWire(member),
		SelfMember:   toGroupMemberWire(selfMember),
		PreviousRole: previousRole,
	})
}

func NewGroupOwnershipTransferredEnvelope(
	groupID string,
	group *chatv1.Group,
	thread *chatv1.GroupChatThread,
	ownerMember *chatv1.GroupMember,
	previousOwnerMember *chatv1.GroupMember,
	selfMember *chatv1.GroupMember,
) Envelope {
	return newEnvelope(EventTypeGroupOwnershipTransferred, GroupOwnershipTransferredPayload{
		GroupID:             groupID,
		Group:               toGroupWire(group),
		Thread:              toGroupThreadWire(thread),
		OwnerMember:         toGroupMemberWire(ownerMember),
		PreviousOwnerMember: toGroupMemberWire(previousOwnerMember),
		SelfMember:          toGroupMemberWire(selfMember),
	})
}

func toGroupWire(group *chatv1.Group) *groupWire {
	if group == nil {
		return nil
	}

	return &groupWire{
		ID:          group.GetId(),
		Name:        group.GetName(),
		Kind:        group.GetKind().String(),
		SelfRole:    group.GetSelfRole().String(),
		MemberCount: group.GetMemberCount(),
		CreatedAt:   formatProtoTimestamp(group.GetCreatedAt()),
		UpdatedAt:   formatProtoTimestamp(group.GetUpdatedAt()),
	}
}

func toGroupThreadWire(thread *chatv1.GroupChatThread) *groupThreadWire {
	if thread == nil {
		return nil
	}

	return &groupThreadWire{
		ID:              thread.GetId(),
		GroupID:         thread.GetGroupId(),
		ThreadKey:       thread.GetThreadKey(),
		CanSendMessages: thread.GetCanSendMessages(),
		CreatedAt:       formatProtoTimestamp(thread.GetCreatedAt()),
		UpdatedAt:       formatProtoTimestamp(thread.GetUpdatedAt()),
	}
}

func toGroupMemberWire(member *chatv1.GroupMember) *groupMemberWire {
	if member == nil {
		return nil
	}

	return &groupMemberWire{
		User: &chatUserWire{
			ID:        member.GetUser().GetId(),
			Login:     member.GetUser().GetLogin(),
			Nickname:  member.GetUser().GetNickname(),
			AvatarURL: member.GetUser().AvatarUrl,
		},
		Role:     member.GetRole().String(),
		JoinedAt: formatProtoTimestamp(member.GetJoinedAt()),
	}
}

func toGroupMessageWire(message *chatv1.GroupMessage) *groupMessageWire {
	if message == nil {
		return nil
	}

	return &groupMessageWire{
		ID:           message.GetId(),
		GroupID:      message.GetGroupId(),
		ThreadID:     message.GetThreadId(),
		SenderUserID: message.GetSenderUserId(),
		Kind:         message.GetKind().String(),
		Text:         toTextMessageContentWire(message.GetText()),
		CreatedAt:    formatProtoTimestamp(message.GetCreatedAt()),
		UpdatedAt:    formatProtoTimestamp(message.GetUpdatedAt()),
	}
}
