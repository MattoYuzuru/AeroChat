import { gatewayClient } from "../gateway/runtime";
import type { CryptoRuntimeContextValue } from "../crypto/runtime-context";
import type { EncryptedDirectMessageV2ReadyProjection } from "../crypto/types";
import { clearBufferedLocalEncryptedDirectMessageV2Projection, listBufferedLocalEncryptedDirectMessageV2Projection,
   publishLocalEncryptedDirectMessageV2Projection } from "../chats/encrypted-v2-local-outbound";
import { clearBufferedEncryptedDirectMessageV2RealtimeEvents, publishEncryptedDirectMessageV2RealtimeEvent } from "../chats/encrypted-v2-realtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectChat, EncryptedGroupBootstrap, Group } from "../gateway/types";
import type { EncryptedDirectMessageV2ProjectionEntry } from "../chats/encrypted-v2-projection";
import type { EncryptedGroupProjectionEntry } from "../groups/encrypted-group-projection";
import {
  clearEncryptedLocalSearchIndex,
  encryptedLocalSearchAllScopeLaneLimit,
  primeEncryptedDirectLocalSearchIndex,
  primeEncryptedGroupLocalSearchIndex,
  queryEncryptedLocalSearchIndex,
  searchEncryptedLocalMessages,
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
    serverSequence: "1",
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
    serverSequence: "1",
    storedAt: createdAt,
    text,
    markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
    attachments: [],
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
          serverSequence: "1",
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
          serverSequence: "1",
          storedAt: "2026-03-22T11:06:00Z",
          text: null,
          markdownPolicy: null,
          attachments: [],
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


afterEach(() => {
  vi.restoreAllMocks();
  clearBufferedLocalEncryptedDirectMessageV2Projection();
  clearBufferedEncryptedDirectMessageV2RealtimeEvents();
});
describe("authoritative local search convergence", () => {
  it("does not compare independent conversation sequences for global result ranking", () => {
    clearEncryptedLocalSearchIndex();
    const olderChat = createDirectChat("older", "2026-10-11T00:00:00Z");
    const newerChat = createDirectChat("newer", olderChat.updatedAt);
    primeEncryptedDirectLocalSearchIndex({ chat: olderChat, items: [{ ...createDirectProjectionEntry("older", "old", "needle old", "2026-10-10T00:00:00Z"), serverSequence: "9223372036854775807" }] });
    primeEncryptedDirectLocalSearchIndex({ chat: newerChat, items: [{ ...createDirectProjectionEntry("newer", "new", "needle new", "2026-10-11T00:00:00Z"), serverSequence: "1" }] });
    expect(queryEncryptedLocalSearchIndex({ query: "needle", scopeSelection: "all-direct",
      directChats: [olderChat, newerChat], groups: [], directChatId: "", groupId: "" }).results.map((result) => result.messageId)).toEqual(["new",
      "old"]);
  });
  it("rebuilds same-timestamp cache from fetch/realtime/send metadata without dropping an unacknowledged outbound", async () => {
    clearEncryptedLocalSearchIndex();
    const chat = createDirectChat("chat", "2026-10-11T00:00:00Z");
    const base: EncryptedDirectMessageV2ReadyProjection = { status: "ready", messageId: "content",
      chatId: chat.id, senderUserId: "user-2", senderCryptoDeviceId: "device", operationKind: "content",
      targetMessageId: null, revision: 1, replyToMessageId: null, createdAt: "2099-01-01T00:00:00Z",
      serverSequence: "9007199254740992", storedAt: chat.updatedAt, payloadSchema: "aerochat.web.encrypted_direct_message_v2.payload.v1",
      text: "needle old", markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1", attachments: [],
      editedAt: null, deletedAt: null };
    const edit: EncryptedDirectMessageV2ReadyProjection = { ...base, messageId: "edit",
      operationKind: "edit", targetMessageId: "content", revision: 2, serverSequence: "9007199254740993",
      createdAt: "2000-01-01T00:00:00Z", text: "needle edited", editedAt: chat.updatedAt };
    const pending: EncryptedDirectMessageV2ReadyProjection = { ...base, messageId: "sent", serverSequence: "9007199254740994", text: "needle sent" };
    publishLocalEncryptedDirectMessageV2Projection(pending);
    primeEncryptedDirectLocalSearchIndex({ chat, items: [createDirectProjectionEntry(chat.id, "stale", "needle stale", chat.updatedAt)] });
    clearEncryptedLocalSearchIndex();
    expect(listBufferedLocalEncryptedDirectMessageV2Projection(chat.id)).toEqual([pending]);
    const delivery = { recipientCryptoDeviceId: "viewer", transportHeader: "header", ciphertext: "cipher", ciphertextSizeBytes: 6, storedAt: chat.updatedAt, unreadState: null };
    const envelope = (projection: EncryptedDirectMessageV2ReadyProjection) => ({ ...projection,
      operationKind: projection.operationKind === "content" ? "ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_CONTENT" : "ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_EDIT",
      viewerDelivery: delivery });
    vi.spyOn(gatewayClient, "listEncryptedDirectMessageV2").mockResolvedValue([envelope(base)]);
    publishEncryptedDirectMessageV2RealtimeEvent({ type: "encrypted_direct_message_v2.delivery", envelope: envelope(edit) });
    const decrypt = vi.fn(async (envelopes: Array<{
      messageId: string;
    }>) => envelopes.map((value) => value.messageId === "edit" ? edit : base));
    const runtime = { state: { status: "ready", snapshot: { localDevice: { status: "active",
            cryptoDeviceId: "viewer" } } }, decryptEncryptedDirectMessageV2Envelopes: decrypt } as unknown as CryptoRuntimeContextValue;
    const input = { query: "needle", scopeSelection: "direct" as const, directChats: [chat],
      groups: [], directChatId: chat.id, groupId: "", token: "token", cryptoRuntime: runtime };
    const result = await searchEncryptedLocalMessages(input);
    expect(decrypt.mock.calls[0]?.[0].map((value) => value.messageId)).toEqual(["content", "edit"]);
    expect(result.results.map((value) => value.matchFragment)).toEqual(["needle edited", "needle sent"]);
    expect(listBufferedLocalEncryptedDirectMessageV2Projection(chat.id)).toEqual([pending]);
    const cached = await searchEncryptedLocalMessages(input);
    expect(cached.results).toEqual(result.results);
    expect(gatewayClient.listEncryptedDirectMessageV2).toHaveBeenCalledTimes(1);
  });
});
