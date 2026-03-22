import { beforeEach, describe, expect, it } from "vitest";
import type { DirectChat, EncryptedGroupBootstrap, Group } from "../gateway/types";
import type { EncryptedDirectMessageV2ProjectionEntry } from "../chats/encrypted-v2-projection";
import type { EncryptedGroupProjectionEntry } from "../groups/encrypted-group-projection";
import {
  clearEncryptedLocalSearchIndex,
  encryptedLocalSearchAllScopeLaneLimit,
  primeEncryptedDirectLocalSearchIndex,
  primeEncryptedGroupLocalSearchIndex,
  queryEncryptedLocalSearchIndex,
} from "./encrypted-local-search";

function createDirectChat(id: string, updatedAt: string): DirectChat {
  return {
    id,
    kind: "CHAT_KIND_DIRECT",
    participants: [
      {
        id: "user-1",
        login: "alice",
        nickname: "Alice",
        avatarUrl: null,
      },
      {
        id: "user-2",
        login: "bob",
        nickname: "Bob",
        avatarUrl: null,
      },
    ],
    pinnedMessageIds: [],
    encryptedPinnedMessageIds: [],
    unreadCount: 0,
    encryptedUnreadCount: 0,
    createdAt: updatedAt,
    updatedAt,
  };
}

function createGroup(id: string, updatedAt: string): Group {
  return {
    id,
    name: `Group ${id}`,
    kind: "CHAT_KIND_GROUP",
    selfRole: "member",
    memberCount: 2,
    unreadCount: 0,
    encryptedUnreadCount: 0,
    permissions: {
      canManageInviteLinks: false,
      creatableInviteRoles: [],
      canManageMemberRoles: false,
      roleManagementTargetRoles: [],
      assignableRoles: [],
      canTransferOwnership: false,
      removableMemberRoles: [],
      restrictableMemberRoles: [],
      canLeaveGroup: true,
    },
    encryptedPinnedMessageIds: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

function createDirectProjectionEntry(
  chatId: string,
  messageId: string,
  text: string,
  createdAt: string,
): EncryptedDirectMessageV2ProjectionEntry {
  return {
    kind: "message",
    key: `message:${messageId}`,
    messageId,
    chatId,
    senderUserId: "user-2",
    senderCryptoDeviceId: "crypto-2",
    revision: 1,
    replyToMessageId: null,
    createdAt,
    storedAt: createdAt,
    text,
    markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
    attachments: [],
    editedAt: null,
    deletedAt: null,
    isTombstone: false,
  };
}

function createGroupProjectionEntry(
  groupId: string,
  messageId: string,
  text: string,
  createdAt: string,
): EncryptedGroupProjectionEntry {
  return {
    kind: "message",
    key: `message:${messageId}`,
    messageId,
    groupId,
    threadId: `${groupId}-thread`,
    mlsGroupId: `${groupId}-mls`,
    rosterVersion: 3,
    senderUserId: "user-3",
    senderCryptoDeviceId: "crypto-3",
    revision: 1,
    replyToMessageId: null,
    createdAt,
    storedAt: createdAt,
    text,
    markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
    editedAt: null,
    deletedAt: null,
    isTombstone: false,
  };
}

function createGroupBootstrap(groupId: string): EncryptedGroupBootstrap {
  return {
    lane: {
      groupId,
      threadId: `${groupId}-thread`,
      mlsGroupId: `${groupId}-mls`,
      rosterVersion: 3,
      activatedAt: "2026-03-22T10:00:00Z",
      updatedAt: "2026-03-22T10:00:00Z",
    },
    rosterMembers: [
      {
        user: {
          id: "user-3",
          login: "carol",
          nickname: "Carol",
          avatarUrl: null,
        },
        role: "member",
        isWriteRestricted: false,
        hasEligibleCryptoDevices: true,
        eligibleCryptoDeviceIds: ["crypto-3"],
      },
    ],
    rosterDevices: [],
  };
}

describe("encrypted local search index", () => {
  beforeEach(() => {
    clearEncryptedLocalSearchIndex();
  });

  it("searches only live locally indexed decrypted entries", () => {
    const directChat = createDirectChat("chat-1", "2026-03-22T10:00:00Z");
    const group = createGroup("group-1", "2026-03-22T11:00:00Z");

    primeEncryptedDirectLocalSearchIndex({
      chat: directChat,
      items: [
        createDirectProjectionEntry(
          directChat.id,
          "message-1",
          "Release candidate note",
          "2026-03-22T10:05:00Z",
        ),
        {
          ...createDirectProjectionEntry(
            directChat.id,
            "message-2",
            "",
            "2026-03-22T10:06:00Z",
          ),
        },
        {
          kind: "failure",
          key: "failure:message-3:1",
          messageId: "message-3",
          chatId: directChat.id,
          senderUserId: "user-2",
          senderCryptoDeviceId: "crypto-2",
          revision: 1,
          createdAt: "2026-03-22T10:07:00Z",
          storedAt: "2026-03-22T10:07:00Z",
          failureKind: "decrypt_failed",
        },
      ],
    });
    primeEncryptedGroupLocalSearchIndex({
      group,
      bootstrap: createGroupBootstrap(group.id),
      items: [
        createGroupProjectionEntry(
          group.id,
          "message-4",
          "Release candidate follow-up",
          "2026-03-22T11:05:00Z",
        ),
        {
          kind: "message",
          key: "message:message-5",
          messageId: "message-5",
          groupId: group.id,
          threadId: `${group.id}-thread`,
          mlsGroupId: `${group.id}-mls`,
          rosterVersion: 3,
          senderUserId: "user-3",
          senderCryptoDeviceId: "crypto-3",
          revision: 1,
          replyToMessageId: null,
          createdAt: "2026-03-22T11:06:00Z",
          storedAt: "2026-03-22T11:06:00Z",
          text: null,
          markdownPolicy: null,
          editedAt: null,
          deletedAt: "2026-03-22T11:06:00Z",
          isTombstone: true,
        },
      ],
    });

    const response = queryEncryptedLocalSearchIndex({
      query: "release candidate",
      scopeSelection: "all-groups",
      directChats: [directChat],
      groups: [group],
      directChatId: "",
      groupId: "",
    });

    expect(response.status).toBe("ready");
    expect(response.results).toEqual([
      {
        lane: "encrypted",
        scope: "group",
        directChatId: null,
        groupId: "group-1",
        groupThreadId: "group-1-thread",
        messageId: "message-4",
        author: {
          id: "user-3",
          login: "carol",
          nickname: "Carol",
          avatarUrl: null,
        },
        createdAt: "2026-03-22T11:05:00Z",
        editedAt: null,
        matchFragment: "Release candidate follow-up",
        position: {
          messageId: "message-4",
          messageCreatedAt: "2026-03-22T11:05:00Z",
        },
      },
    ]);
  });

  it("limits all-direct search to the recent lane budget and reports it honestly", () => {
    const directChats = Array.from(
      { length: encryptedLocalSearchAllScopeLaneLimit + 2 },
      (_, index) => {
        const chat = createDirectChat(
          `chat-${index + 1}`,
          `2026-03-22T10:${String(index).padStart(2, "0")}:00Z`,
        );
        primeEncryptedDirectLocalSearchIndex({
          chat,
          items: [
            createDirectProjectionEntry(
              chat.id,
              `message-${index + 1}`,
              `needle ${index + 1}`,
              `2026-03-22T10:${String(index).padStart(2, "0")}:30Z`,
            ),
          ],
        });
        return chat;
      },
    );

    const response = queryEncryptedLocalSearchIndex({
      query: "needle",
      scopeSelection: "all-direct",
      directChats,
      groups: [],
      directChatId: "",
      groupId: "",
    });

    expect(response.summary.availableLaneCount).toBe(encryptedLocalSearchAllScopeLaneLimit + 2);
    expect(response.summary.searchedLaneCount).toBe(encryptedLocalSearchAllScopeLaneLimit);
    expect(response.summary.limitedByLaneBudget).toBe(true);
    expect(response.results).toHaveLength(encryptedLocalSearchAllScopeLaneLimit);
    expect(response.results[0]?.directChatId).toBe(`chat-${encryptedLocalSearchAllScopeLaneLimit + 2}`);
  });
});
