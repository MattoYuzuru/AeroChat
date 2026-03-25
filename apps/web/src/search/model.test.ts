import { describe, expect, it } from "vitest";
import type {
  DirectChat,
  Group,
} from "../gateway/types";
import {
  buildMessageSearchScope,
  buildSearchResultHref,
  describeDirectChatLabel,
  describeLegacySearchEmptyState,
  describeLegacySearchPath,
  describeSearchResultAuthor,
  describeSearchResultContainer,
  describeSearchResultScope,
  type SearchResultLike,
} from "./model";

type TestSearchResult = SearchResultLike & {
  createdAt: string;
  editedAt: string | null;
  matchFragment: string;
  groupThreadId: string | null;
};

function createDirectChat(overrides: Partial<DirectChat> = {}): DirectChat {
  return {
    id: "chat-1",
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
    unreadCount: 0,
    encryptedUnreadCount: 0,
    createdAt: "2026-03-21T10:00:00Z",
    updatedAt: "2026-03-21T10:00:00Z",
    ...overrides,
    encryptedPinnedMessageIds: overrides.encryptedPinnedMessageIds ?? [],
  };
}

function createGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: "group-1",
    name: "Aero Team",
    kind: "CHAT_KIND_GROUP",
    selfRole: "member",
    memberCount: 3,
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
    createdAt: "2026-03-21T10:00:00Z",
    updatedAt: "2026-03-21T10:00:00Z",
    ...overrides,
    encryptedPinnedMessageIds: overrides.encryptedPinnedMessageIds ?? [],
  };
}

function createResult(overrides: Partial<TestSearchResult> = {}): TestSearchResult {
  return {
    scope: "direct",
    lane: "plaintext",
    directChatId: "chat-1",
    groupId: null,
    groupThreadId: null,
    messageId: "message-1",
    author: {
      id: "user-2",
      login: "bob",
      nickname: "Bob",
      avatarUrl: null,
    },
    createdAt: "2026-03-21T10:00:00Z",
    editedAt: null,
    matchFragment: "search fragment",
    position: {
      messageId: "message-1",
      messageCreatedAt: "2026-03-21T10:00:00Z",
    },
    ...overrides,
  };
}

describe("buildMessageSearchScope", () => {
  it("builds all-direct scope without container id", () => {
    expect(buildMessageSearchScope("all-direct", "", "")).toEqual({
      kind: "direct",
    });
  });

  it("requires an explicit direct chat id for one-chat scope", () => {
    expect(buildMessageSearchScope("direct", "", "")).toBeNull();
    expect(buildMessageSearchScope("direct", "chat-9", "")).toEqual({
      kind: "direct",
      chatId: "chat-9",
    });
  });

  it("requires an explicit group id for one-group scope", () => {
    expect(buildMessageSearchScope("group", "", "")).toBeNull();
    expect(buildMessageSearchScope("group", "", "group-9")).toEqual({
      kind: "group",
      groupId: "group-9",
    });
  });
});

describe("buildSearchResultHref", () => {
  it("routes direct results into chats page with search jump params", () => {
    expect(buildSearchResultHref(createResult())).toBe(
      "/app/chats?message=message-1&from=search&chat=chat-1",
    );
  });

  it("routes group results into groups page with search jump params", () => {
    expect(
      buildSearchResultHref(
        createResult({
          scope: "group",
          directChatId: null,
          groupId: "group-1",
        }),
      ),
    ).toBe("/app/groups?message=message-1&from=search&group=group-1");
  });

  it("adds encrypted lane marker for local encrypted results", () => {
    expect(
      buildSearchResultHref(
        createResult({
          lane: "encrypted",
        }),
      ),
    ).toBe("/app/chats?message=message-1&from=search&lane=encrypted&chat=chat-1");
  });

  it("keeps encrypted lane marker for group results to avoid plaintext jump fallback", () => {
    expect(
      buildSearchResultHref(
        createResult({
          scope: "group",
          lane: "encrypted",
          directChatId: null,
          groupId: "group-1",
        }),
      ),
    ).toBe("/app/groups?message=message-1&from=search&lane=encrypted&group=group-1");
  });
});

describe("search result labels", () => {
  it("describes direct chat container and peer label", () => {
    const chat = createDirectChat();

    expect(describeDirectChatLabel(chat, "user-1")).toBe("Bob · @bob");
    expect(
      describeSearchResultContainer(createResult(), [chat], [], "user-1"),
    ).toBe("Bob · @bob");
  });

  it("describes group container from loaded group list", () => {
    const result = createResult({
      scope: "group",
      directChatId: null,
      groupId: "group-1",
    });

    expect(
      describeSearchResultContainer(result, [], [createGroup()], "user-1"),
    ).toBe("Aero Team");
    expect(describeSearchResultScope(result)).toBe("Группа");
  });

  it("uses current-user author label when hit belongs to viewer", () => {
    expect(
      describeSearchResultAuthor(
        {
          id: "user-1",
          login: "alice",
          nickname: "Alice",
          avatarUrl: null,
        },
        "user-1",
      ),
    ).toBe("Вы");
  });
});

describe("legacy search boundary copy", () => {
  it("makes direct server-side de-scope explicit", () => {
    expect(describeLegacySearchPath("all-direct")).toBe(
      "Серверный поиск по содержимому личных чатов сейчас недоступен.",
    );
    expect(describeLegacySearchEmptyState("direct")).toBe(
      "В этой области доступны только результаты из текущей локальной сессии.",
    );
  });

  it("makes group server-side de-scope explicit", () => {
    expect(describeLegacySearchPath("group")).toBe(
      "Серверный поиск по содержимому групп сейчас недоступен.",
    );
    expect(describeLegacySearchEmptyState("all-groups")).toBe(
      "В этой области доступны только результаты из текущей локальной сессии.",
    );
  });
});
