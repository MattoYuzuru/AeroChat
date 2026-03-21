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

	resolvedGroup, thread, readState, typingState, err := service.GetGroupChat(context.Background(), alice.Token, group.ID)
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
	if readState != nil {
		t.Fatalf("для новой группы не ожидался read state, получено %+v", readState)
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

	resolvedGroup, thread, readState, typingState, err := service.GetGroupChat(context.Background(), bob.Token, group.ID)
	if err != nil {
		t.Fatalf("get group chat as reader: %v", err)
	}
	if resolvedGroup.SelfRole != GroupMemberRoleReader {
		t.Fatalf("ожидалась роль reader, получено %q", resolvedGroup.SelfRole)
	}
	if thread.CanSendMessages {
		t.Fatal("reader не должен иметь право отправки")
	}
	if readState != nil {
		t.Fatalf("до чтения reader не должен иметь read position, получено %+v", readState)
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

	if _, err := service.SendGroupTextMessage(context.Background(), bob.Token, group.ID, "reader write", nil); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("ожидалась ошибка read-only роли, получено %v", err)
	}
}

func TestGroupMessagesSupportReplyPreview(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	service.randReader = bytes.NewReader(bytes.Repeat([]byte{9}, 64))

	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")

	group := mustCreateGroup(t, service, alice.Token, "Reply group")
	memberInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleMember)
	if err != nil {
		t.Fatalf("create member invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), bob.Token, memberInvite.InviteToken); err != nil {
		t.Fatalf("join member invite: %v", err)
	}

	target := mustSendGroupMessage(t, service, bob.Token, group.ID, "group reply target")
	reply, err := service.SendGroupTextMessage(context.Background(), alice.Token, group.ID, "reply", nil, target.ID)
	if err != nil {
		t.Fatalf("send group reply: %v", err)
	}
	if reply.ReplyToMessageID == nil || *reply.ReplyToMessageID != target.ID {
		t.Fatalf("ожидался group reply target %q, получено %+v", target.ID, reply.ReplyToMessageID)
	}
	if reply.ReplyPreview == nil || reply.ReplyPreview.MessageID != target.ID {
		t.Fatalf("ожидался group reply preview, получено %+v", reply.ReplyPreview)
	}
	if reply.ReplyPreview.Author == nil || reply.ReplyPreview.Author.ID != bob.User.ID {
		t.Fatalf("ожидался author summary Bob в group reply preview, получено %+v", reply.ReplyPreview)
	}

	messages, err := service.ListGroupMessages(context.Background(), alice.Token, group.ID, 0)
	if err != nil {
		t.Fatalf("list group messages: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("ожидалось 2 сообщения в группе, получено %d", len(messages))
	}
	if messages[0].ReplyPreview == nil || messages[0].ReplyPreview.MessageID != target.ID {
		t.Fatalf("ожидался reply preview в group history, получено %+v", messages[0].ReplyPreview)
	}
}

func TestGroupMessagesRejectRawHTMLAndRequireMembership(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")

	group := mustCreateGroup(t, service, alice.Token, "Secure")

	if _, err := service.SendGroupTextMessage(context.Background(), alice.Token, group.ID, "<b>unsafe</b>", nil); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("ожидалась ошибка raw HTML для group message, получено %v", err)
	}
	if _, err := service.SendGroupTextMessage(context.Background(), alice.Token, group.ID, "   ", nil); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("ожидалась ошибка пустого group message, получено %v", err)
	}

	if _, _, _, _, err := service.GetGroupChat(context.Background(), bob.Token, group.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась ошибка доступа к group chat для неучастника, получено %v", err)
	}
	if _, err := service.ListGroupMessages(context.Background(), bob.Token, group.ID, 0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась ошибка доступа к group messages для неучастника, получено %v", err)
	}
}

func TestEditGroupMessageAllowsAuthorAfterDowngradeToReader(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	service.randReader = bytes.NewReader(bytes.Repeat([]byte{10}, 64))

	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")

	group := mustCreateGroup(t, service, alice.Token, "Editors")
	memberInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleMember)
	if err != nil {
		t.Fatalf("create member invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), bob.Token, memberInvite.InviteToken); err != nil {
		t.Fatalf("join member invite: %v", err)
	}

	message := mustSendGroupMessage(t, service, bob.Token, group.ID, "draft")
	member, err := service.UpdateGroupMemberRole(context.Background(), alice.Token, group.ID, bob.User.ID, GroupMemberRoleReader)
	if err != nil {
		t.Fatalf("downgrade Bob to reader: %v", err)
	}
	if member.Role != GroupMemberRoleReader {
		t.Fatalf("ожидалась роль reader после downgrade, получено %q", member.Role)
	}
	if _, err := service.SendGroupTextMessage(context.Background(), bob.Token, group.ID, "new send denied", nil); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("reader не должен отправлять новые сообщения, получено %v", err)
	}

	edited, err := service.EditGroupMessage(context.Background(), bob.Token, group.ID, message.ID, "edited by reader")
	if err != nil {
		t.Fatalf("edit group message after downgrade: %v", err)
	}
	if edited.Text == nil || edited.Text.Text != "edited by reader" {
		t.Fatalf("ожидался обновлённый group text, получено %+v", edited.Text)
	}
	if edited.EditedAt == nil {
		t.Fatal("ожидался explicit edited_at после group edit")
	}
}

func TestEditGroupMessageRejectsNonAuthorAndAttachmentOnly(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	service.randReader = bytes.NewReader(bytes.Repeat([]byte{11}, 64))

	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")

	group := mustCreateGroup(t, service, alice.Token, "Guard rails")
	memberInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleMember)
	if err != nil {
		t.Fatalf("create member invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), bob.Token, memberInvite.InviteToken); err != nil {
		t.Fatalf("join member invite: %v", err)
	}

	message := mustSendGroupMessage(t, service, alice.Token, group.ID, "owner text")
	if _, err := service.EditGroupMessage(context.Background(), bob.Token, group.ID, message.ID, "unauthorized"); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("ожидалась ошибка group edit author only, получено %v", err)
	}

	intent, err := service.CreateAttachmentUploadIntent(
		context.Background(),
		alice.Token,
		"",
		group.ID,
		"note.txt",
		"text/plain",
		64,
	)
	if err != nil {
		t.Fatalf("create group attachment intent: %v", err)
	}
	repo.objectStorage.objects[intent.Attachment.ObjectKey] = StoredObjectInfo{
		Size:        intent.Attachment.SizeBytes,
		ContentType: intent.Attachment.MimeType,
	}
	uploadedAttachment, err := service.CompleteAttachmentUpload(context.Background(), alice.Token, intent.Attachment.ID, intent.UploadSession.ID)
	if err != nil {
		t.Fatalf("complete group attachment upload: %v", err)
	}

	attachmentOnly, err := service.SendGroupTextMessage(context.Background(), alice.Token, group.ID, "   ", []string{uploadedAttachment.ID})
	if err != nil {
		t.Fatalf("send attachment-only group message: %v", err)
	}
	if attachmentOnly.Text != nil {
		t.Fatal("ожидался attachment-only group message без text payload")
	}
	if _, err := service.EditGroupMessage(context.Background(), alice.Token, group.ID, attachmentOnly.ID, "new text"); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка edit attachment-only group message, получено %v", err)
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

	_, thread, _, initialTypingState, err := service.GetGroupChat(context.Background(), alice.Token, group.ID)
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

	_, _, _, fetchedTypingState, err := service.GetGroupChat(context.Background(), alice.Token, group.ID)
	if err != nil {
		t.Fatalf("get group chat with typing: %v", err)
	}
	if len(fetchedTypingState.Typers) != 1 || fetchedTypingState.Typers[0].User.ID != bob.User.ID {
		t.Fatalf("Alice должна видеть typing Bob, получено %+v", fetchedTypingState)
	}

	currentTime = currentTime.Add(6 * time.Second)

	_, _, _, expiredTypingState, err := service.GetGroupChat(context.Background(), alice.Token, group.ID)
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

	_, thread, _, _, err := service.GetGroupChat(context.Background(), alice.Token, group.ID)
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

	_, _, _, fetchedTypingState, err := service.GetGroupChat(context.Background(), alice.Token, group.ID)
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

	_, thread, _, _, err := service.GetGroupChat(context.Background(), alice.Token, group.ID)
	if err != nil {
		t.Fatalf("get group chat: %v", err)
	}

	if _, err := service.SetGroupTyping(context.Background(), bob.Token, group.ID, thread.ID); err != nil {
		t.Fatalf("set group typing for Bob: %v", err)
	}
	if _, err := service.UpdateGroupMemberRole(context.Background(), alice.Token, group.ID, bob.User.ID, GroupMemberRoleReader); err != nil {
		t.Fatalf("downgrade Bob to reader: %v", err)
	}

	_, _, _, afterDowngradeTypingState, err := service.GetGroupChat(context.Background(), alice.Token, group.ID)
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

	_, _, _, afterLeaveTypingState, err := service.GetGroupChat(context.Background(), alice.Token, group.ID)
	if err != nil {
		t.Fatalf("get group chat after leave: %v", err)
	}
	if len(afterLeaveTypingState.Typers) != 0 {
		t.Fatalf("typing должен очищаться после leave group, получено %+v", afterLeaveTypingState)
	}
}

func TestGroupUnreadIsViewerRelativeAndReaderCanClearIt(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	service.randReader = bytes.NewReader(bytes.Repeat([]byte{13}, 64))

	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")

	group := mustCreateGroup(t, service, alice.Token, "Unread")
	readerInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleReader)
	if err != nil {
		t.Fatalf("create reader invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), bob.Token, readerInvite.InviteToken); err != nil {
		t.Fatalf("join reader invite: %v", err)
	}

	first := mustSendGroupMessage(t, service, alice.Token, group.ID, "first")
	second := mustSendGroupMessage(t, service, alice.Token, group.ID, "second")

	bobGroups, err := service.ListGroups(context.Background(), bob.Token)
	if err != nil {
		t.Fatalf("list groups as Bob: %v", err)
	}
	if len(bobGroups) != 1 {
		t.Fatalf("ожидалась одна группа у Bob, получено %d", len(bobGroups))
	}
	if bobGroups[0].UnreadCount != 2 {
		t.Fatalf("ожидалось 2 непрочитанных сообщения у Bob, получено %d", bobGroups[0].UnreadCount)
	}

	groupSnapshot, _, readState, _, err := service.GetGroupChat(context.Background(), bob.Token, group.ID)
	if err != nil {
		t.Fatalf("get group chat as Bob: %v", err)
	}
	if groupSnapshot.UnreadCount != 2 {
		t.Fatalf("ожидалось 2 непрочитанных в snapshot группы, получено %d", groupSnapshot.UnreadCount)
	}
	if readState != nil {
		t.Fatalf("до mark read не ожидался read state, получено %+v", readState)
	}

	readState, unreadCount, err := service.MarkGroupChatRead(context.Background(), bob.Token, group.ID, first.ID)
	if err != nil {
		t.Fatalf("mark group chat read at first message: %v", err)
	}
	if readState == nil || readState.SelfPosition == nil || readState.SelfPosition.MessageID != first.ID {
		t.Fatal("ожидалась фиксация group read position на первом сообщении")
	}
	if unreadCount != 1 {
		t.Fatalf("ожидалось 1 непрочитанное после чтения первого сообщения, получено %d", unreadCount)
	}

	third := mustSendGroupMessage(t, service, alice.Token, group.ID, "third")

	groupSnapshot, _, readState, _, err = service.GetGroupChat(context.Background(), bob.Token, group.ID)
	if err != nil {
		t.Fatalf("get group chat after third message: %v", err)
	}
	if groupSnapshot.UnreadCount != 2 {
		t.Fatalf("ожидалось 2 непрочитанных после нового сообщения, получено %d", groupSnapshot.UnreadCount)
	}
	if readState == nil || readState.SelfPosition == nil || readState.SelfPosition.MessageID != first.ID {
		t.Fatal("read state должен сохранять последнюю прочитанную позицию")
	}

	readState, unreadCount, err = service.MarkGroupChatRead(context.Background(), bob.Token, group.ID, third.ID)
	if err != nil {
		t.Fatalf("mark group chat read at third message: %v", err)
	}
	if readState == nil || readState.SelfPosition == nil || readState.SelfPosition.MessageID != third.ID {
		t.Fatal("ожидалась фиксация group read position на последнем сообщении")
	}
	if unreadCount != 0 {
		t.Fatalf("ожидалось отсутствие непрочитанных после полного чтения, получено %d", unreadCount)
	}

	aliceGroups, err := service.ListGroups(context.Background(), alice.Token)
	if err != nil {
		t.Fatalf("list groups as Alice: %v", err)
	}
	if len(aliceGroups) != 1 {
		t.Fatalf("ожидалась одна группа у Alice, получено %d", len(aliceGroups))
	}
	if aliceGroups[0].UnreadCount != 0 {
		t.Fatalf("собственные сообщения не должны увеличивать unread автора, получено %d", aliceGroups[0].UnreadCount)
	}

	readState, unreadCount, err = service.MarkGroupChatRead(context.Background(), bob.Token, group.ID, second.ID)
	if err != nil {
		t.Fatalf("mark group chat read backwards: %v", err)
	}
	if readState == nil || readState.SelfPosition == nil || readState.SelfPosition.MessageID != third.ID {
		t.Fatal("group read position не должна откатываться назад")
	}
	if unreadCount != 0 {
		t.Fatalf("ожидалось 0 непрочитанных после backward mark, получено %d", unreadCount)
	}
}
