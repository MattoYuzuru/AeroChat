package chat

import (
	"bytes"
	"context"
	"errors"
	"testing"
)

func TestGetGroupChatBootstrapsPrimaryThread(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")

	group := mustCreateGroup(t, service, alice.Token, "Core team")

	resolvedGroup, thread, err := service.GetGroupChat(context.Background(), alice.Token, group.ID)
	if err != nil {
		t.Fatalf("get group chat: %v", err)
	}
	if resolvedGroup.ID != group.ID {
		t.Fatalf("ожидалась группа %q, получено %q", group.ID, resolvedGroup.ID)
	}
	if thread.GroupID != group.ID {
		t.Fatalf("ожидалась привязка thread к группе %q, получено %q", group.ID, thread.GroupID)
	}
	if thread.ThreadKey != GroupThreadKeyPrimary {
		t.Fatalf("ожидался primary thread key, получено %q", thread.ThreadKey)
	}
	if !thread.CanSendMessages {
		t.Fatal("owner должен иметь право отправки в primary thread")
	}
}

func TestGroupMessageSendPolicyHonorsRoles(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	service.randReader = bytes.NewReader(bytes.Repeat([]byte{5}, 64))

	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	charlie := repo.mustIssueAuth(testUUID(3), "charlie", "Charlie")

	group := mustCreateGroup(t, service, alice.Token, "Ops")

	adminInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleAdmin)
	if err != nil {
		t.Fatalf("create admin invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), bob.Token, adminInvite.InviteToken); err != nil {
		t.Fatalf("join admin invite: %v", err)
	}

	service.randReader = bytes.NewReader(bytes.Repeat([]byte{6}, 64))
	memberInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleMember)
	if err != nil {
		t.Fatalf("create member invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), charlie.Token, memberInvite.InviteToken); err != nil {
		t.Fatalf("join member invite: %v", err)
	}

	ownerMessage := mustSendGroupMessage(t, service, alice.Token, group.ID, "owner message")
	adminMessage := mustSendGroupMessage(t, service, bob.Token, group.ID, "admin message")
	memberMessage := mustSendGroupMessage(t, service, charlie.Token, group.ID, "member message")

	messages, err := service.ListGroupMessages(context.Background(), alice.Token, group.ID, 0)
	if err != nil {
		t.Fatalf("list group messages: %v", err)
	}
	if len(messages) != 3 {
		t.Fatalf("ожидалось 3 сообщения в группе, получено %d", len(messages))
	}
	if messages[0].ID != memberMessage.ID || messages[1].ID != adminMessage.ID || messages[2].ID != ownerMessage.ID {
		t.Fatal("ожидалась сортировка group timeline по убыванию created_at")
	}
}

func TestReaderGroupRoleIsReadOnlyInMessageFlow(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	service.randReader = bytes.NewReader(bytes.Repeat([]byte{7}, 64))

	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")

	group := mustCreateGroup(t, service, alice.Token, "Readers")
	firstMessage := mustSendGroupMessage(t, service, alice.Token, group.ID, "only read me")

	readerInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleReader)
	if err != nil {
		t.Fatalf("create reader invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), bob.Token, readerInvite.InviteToken); err != nil {
		t.Fatalf("join reader invite: %v", err)
	}

	resolvedGroup, thread, err := service.GetGroupChat(context.Background(), bob.Token, group.ID)
	if err != nil {
		t.Fatalf("get group chat as reader: %v", err)
	}
	if resolvedGroup.SelfRole != GroupMemberRoleReader {
		t.Fatalf("ожидалась роль reader, получено %q", resolvedGroup.SelfRole)
	}
	if thread.CanSendMessages {
		t.Fatal("reader не должен иметь право отправки")
	}

	messages, err := service.ListGroupMessages(context.Background(), bob.Token, group.ID, 0)
	if err != nil {
		t.Fatalf("reader list group messages: %v", err)
	}
	if len(messages) != 1 || messages[0].ID != firstMessage.ID {
		t.Fatal("reader должен видеть существующую историю группы")
	}

	if _, err := service.SendGroupTextMessage(context.Background(), bob.Token, group.ID, "reader write"); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("ожидалась ошибка read-only роли, получено %v", err)
	}
}

func TestGroupMessagesRejectRawHTMLAndRequireMembership(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")

	group := mustCreateGroup(t, service, alice.Token, "Secure")

	if _, err := service.SendGroupTextMessage(context.Background(), alice.Token, group.ID, "<b>unsafe</b>"); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("ожидалась ошибка raw HTML для group message, получено %v", err)
	}

	if _, _, err := service.GetGroupChat(context.Background(), bob.Token, group.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась ошибка доступа к group chat для неучастника, получено %v", err)
	}
	if _, err := service.ListGroupMessages(context.Background(), bob.Token, group.ID, 0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась ошибка доступа к group messages для неучастника, получено %v", err)
	}
}
