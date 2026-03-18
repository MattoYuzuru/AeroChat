package chat

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"
)

func TestGetGroupChatBootstrapsPrimaryThread(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")

	group := mustCreateGroup(t, service, alice.Token, "Core team")

	resolvedGroup, thread, typingState, err := service.GetGroupChat(context.Background(), alice.Token, group.ID)
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
	if typingState == nil || typingState.ThreadID != thread.ID || len(typingState.Typers) != 0 {
		t.Fatalf("ожидался пустой typing snapshot для thread %q, получено %+v", thread.ID, typingState)
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

	resolvedGroup, thread, typingState, err := service.GetGroupChat(context.Background(), bob.Token, group.ID)
	if err != nil {
		t.Fatalf("get group chat as reader: %v", err)
	}
	if resolvedGroup.SelfRole != GroupMemberRoleReader {
		t.Fatalf("ожидалась роль reader, получено %q", resolvedGroup.SelfRole)
	}
	if thread.CanSendMessages {
		t.Fatal("reader не должен иметь право отправки")
	}
	if typingState == nil || typingState.ThreadID != thread.ID {
		t.Fatalf("ожидался typing snapshot reader для thread %q, получено %+v", thread.ID, typingState)
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

	if _, _, _, err := service.GetGroupChat(context.Background(), bob.Token, group.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась ошибка доступа к group chat для неучастника, получено %v", err)
	}
	if _, err := service.ListGroupMessages(context.Background(), bob.Token, group.ID, 0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась ошибка доступа к group messages для неучастника, получено %v", err)
	}
}

func TestSetAndClearGroupTypingUsesTTLAndThreadScope(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	currentTime := time.Date(2026, 4, 11, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time {
		return currentTime
	}
	service.typingTTL = 5 * time.Second
	service.randReader = bytes.NewReader(bytes.Repeat([]byte{8}, 64))

	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")

	group := mustCreateGroup(t, service, alice.Token, "Typing")
	memberInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleMember)
	if err != nil {
		t.Fatalf("create member invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), bob.Token, memberInvite.InviteToken); err != nil {
		t.Fatalf("join member invite: %v", err)
	}

	_, thread, initialTypingState, err := service.GetGroupChat(context.Background(), alice.Token, group.ID)
	if err != nil {
		t.Fatalf("get group chat before typing: %v", err)
	}
	if initialTypingState == nil || len(initialTypingState.Typers) != 0 {
		t.Fatalf("ожидался пустой group typing state, получено %+v", initialTypingState)
	}

	typingState, err := service.SetGroupTyping(context.Background(), bob.Token, group.ID, thread.ID)
	if err != nil {
		t.Fatalf("set group typing: %v", err)
	}
	if typingState == nil || len(typingState.Typers) != 1 || typingState.Typers[0].User.ID != bob.User.ID {
		t.Fatalf("ожидался typing snapshot Bob, получено %+v", typingState)
	}

	_, _, fetchedTypingState, err := service.GetGroupChat(context.Background(), alice.Token, group.ID)
	if err != nil {
		t.Fatalf("get group chat with typing: %v", err)
	}
	if len(fetchedTypingState.Typers) != 1 || fetchedTypingState.Typers[0].User.ID != bob.User.ID {
		t.Fatalf("Alice должна видеть typing Bob, получено %+v", fetchedTypingState)
	}

	currentTime = currentTime.Add(6 * time.Second)

	_, _, expiredTypingState, err := service.GetGroupChat(context.Background(), alice.Token, group.ID)
	if err != nil {
		t.Fatalf("get group chat after typing ttl: %v", err)
	}
	if len(expiredTypingState.Typers) != 0 {
		t.Fatalf("group typing должен исчезнуть после TTL, получено %+v", expiredTypingState)
	}

	currentTime = currentTime.Add(time.Second)
	if _, err := service.SetGroupTyping(context.Background(), bob.Token, group.ID, thread.ID); err != nil {
		t.Fatalf("set group typing before clear: %v", err)
	}
	clearedTypingState, err := service.ClearGroupTyping(context.Background(), bob.Token, group.ID, thread.ID)
	if err != nil {
		t.Fatalf("clear group typing: %v", err)
	}
	if len(clearedTypingState.Typers) != 0 {
		t.Fatalf("после clear group typing state должен быть пустым, получено %+v", clearedTypingState)
	}

	if _, err := service.SetGroupTyping(context.Background(), bob.Token, group.ID, testUUID(999)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась ошибка thread scope для group typing, получено %v", err)
	}
}

func TestGroupTypingHonorsVisibilityAndRolePolicy(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	service.randReader = bytes.NewReader(bytes.Repeat([]byte{9}, 64))

	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	charlie := repo.mustIssueAuth(testUUID(3), "charlie", "Charlie")

	group := mustCreateGroup(t, service, alice.Token, "Privacy")

	memberInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleMember)
	if err != nil {
		t.Fatalf("create member invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), bob.Token, memberInvite.InviteToken); err != nil {
		t.Fatalf("join member invite: %v", err)
	}

	service.randReader = bytes.NewReader(bytes.Repeat([]byte{10}, 64))
	readerInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleReader)
	if err != nil {
		t.Fatalf("create reader invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), charlie.Token, readerInvite.InviteToken); err != nil {
		t.Fatalf("join reader invite: %v", err)
	}

	_, thread, _, err := service.GetGroupChat(context.Background(), alice.Token, group.ID)
	if err != nil {
		t.Fatalf("get group chat: %v", err)
	}

	if _, err := service.SetGroupTyping(context.Background(), bob.Token, group.ID, thread.ID); err != nil {
		t.Fatalf("set group typing before privacy change: %v", err)
	}

	repo.setTypingVisibilityEnabled(bob.User.ID, false)

	typingState, err := service.SetGroupTyping(context.Background(), bob.Token, group.ID, thread.ID)
	if err != nil {
		t.Fatalf("set group typing with disabled privacy flag: %v", err)
	}
	if typingState == nil || len(typingState.Typers) != 0 {
		t.Fatalf("typing state не должен раскрываться при отключённой видимости, получено %+v", typingState)
	}

	_, _, fetchedTypingState, err := service.GetGroupChat(context.Background(), alice.Token, group.ID)
	if err != nil {
		t.Fatalf("get group chat after privacy change: %v", err)
	}
	if len(fetchedTypingState.Typers) != 0 {
		t.Fatalf("Alice не должна видеть typing Bob при отключённой видимости, получено %+v", fetchedTypingState)
	}

	if _, err := service.SetGroupTyping(context.Background(), charlie.Token, group.ID, thread.ID); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("ожидалась ошибка typing для reader, получено %v", err)
	}
}

func TestGroupTypingClearsOnRoleDowngradeAndLeave(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	service.randReader = bytes.NewReader(bytes.Repeat([]byte{11}, 64))

	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	charlie := repo.mustIssueAuth(testUUID(3), "charlie", "Charlie")

	group := mustCreateGroup(t, service, alice.Token, "Lifecycle")

	memberInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleMember)
	if err != nil {
		t.Fatalf("create first member invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), bob.Token, memberInvite.InviteToken); err != nil {
		t.Fatalf("join first member invite: %v", err)
	}

	service.randReader = bytes.NewReader(bytes.Repeat([]byte{12}, 64))
	secondInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleMember)
	if err != nil {
		t.Fatalf("create second member invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), charlie.Token, secondInvite.InviteToken); err != nil {
		t.Fatalf("join second member invite: %v", err)
	}

	_, thread, _, err := service.GetGroupChat(context.Background(), alice.Token, group.ID)
	if err != nil {
		t.Fatalf("get group chat: %v", err)
	}

	if _, err := service.SetGroupTyping(context.Background(), bob.Token, group.ID, thread.ID); err != nil {
		t.Fatalf("set group typing for Bob: %v", err)
	}
	if _, err := service.UpdateGroupMemberRole(context.Background(), alice.Token, group.ID, bob.User.ID, GroupMemberRoleReader); err != nil {
		t.Fatalf("downgrade Bob to reader: %v", err)
	}

	_, _, afterDowngradeTypingState, err := service.GetGroupChat(context.Background(), alice.Token, group.ID)
	if err != nil {
		t.Fatalf("get group chat after role downgrade: %v", err)
	}
	if len(afterDowngradeTypingState.Typers) != 0 {
		t.Fatalf("typing должен очищаться после downgrade в reader, получено %+v", afterDowngradeTypingState)
	}

	if _, err := service.SetGroupTyping(context.Background(), charlie.Token, group.ID, thread.ID); err != nil {
		t.Fatalf("set group typing for Charlie: %v", err)
	}
	if err := service.LeaveGroup(context.Background(), charlie.Token, group.ID); err != nil {
		t.Fatalf("leave group for Charlie: %v", err)
	}

	_, _, afterLeaveTypingState, err := service.GetGroupChat(context.Background(), alice.Token, group.ID)
	if err != nil {
		t.Fatalf("get group chat after leave: %v", err)
	}
	if len(afterLeaveTypingState.Typers) != 0 {
		t.Fatalf("typing должен очищаться после leave group, получено %+v", afterLeaveTypingState)
	}
}
