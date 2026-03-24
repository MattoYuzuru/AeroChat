import { describe, expect, it } from "vitest";
import {
  buildDirectChatRoutePath,
  buildExplorerFolderRoutePath,
  buildExplorerRoutePath,
  buildFriendRequestsRoutePath,
  buildGroupChatRoutePath,
  buildPersonProfileRoutePath,
  buildSelfChatRoutePath,
  resolveShellRouteEntry,
} from "./app-routes";

describe("resolveShellRouteEntry", () => {
  it("maps direct chat deep-links to canonical direct_chat targets", () => {
    const resolved = resolveShellRouteEntry(
      "/app/chats",
      "?chat=chat-1&message=message-7&from=search",
    );

    expect(resolved).not.toBeNull();
    expect(resolved?.app.appId).toBe("direct_chat");
    expect(resolved?.target).toEqual({
      key: "chat-1",
      title: "Личный чат",
      routePath: "/app/chats?chat=chat-1&message=message-7&from=search",
    });
  });

  it("maps group deep-links to canonical group_chat targets", () => {
    const resolved = resolveShellRouteEntry(
      "/app/groups",
      "?group=group-4&message=message-2&from=search",
    );

    expect(resolved).not.toBeNull();
    expect(resolved?.app.appId).toBe("group_chat");
    expect(resolved?.target).toEqual({
      key: "group-4",
      title: "Группа",
      routePath: "/app/groups?group=group-4&message=message-2&from=search",
    });
  });

  it("keeps chats route without chat id as the singleton launcher surface", () => {
    const resolved = resolveShellRouteEntry("/app/chats", "?peer=user-7");

    expect(resolved).not.toBeNull();
    expect(resolved?.app.appId).toBe("chats");
    expect(resolved?.target?.routePath).toBe("/app/chats?peer=user-7");
  });

  it("maps person profile deep-links to canonical person_profile targets", () => {
    const resolved = resolveShellRouteEntry("/app/people", "?person=user-7&from=search");

    expect(resolved).not.toBeNull();
    expect(resolved?.app.appId).toBe("person_profile");
    expect(resolved?.target).toEqual({
      key: "user-7",
      title: "Профиль контакта",
      routePath: "/app/people?person=user-7&from=search",
    });
  });

  it("maps friend requests route to the canonical singleton target", () => {
    const resolved = resolveShellRouteEntry("/app/friend-requests", "?from=desktop");

    expect(resolved).not.toBeNull();
    expect(resolved?.app.appId).toBe("friend_requests");
    expect(resolved?.target).toEqual({
      key: "friend_requests",
      title: "Заявки",
      routePath: "/app/friend-requests?from=desktop",
    });
  });

  it("maps self chat route to the canonical singleton target", () => {
    const resolved = resolveShellRouteEntry("/app/self", "?from=desktop");

    expect(resolved).not.toBeNull();
    expect(resolved?.app.appId).toBe("self_chat");
    expect(resolved?.target).toEqual({
      key: "self_chat",
      title: "Я",
      routePath: "/app/self?from=desktop",
    });
  });

  it("maps explorer route to the canonical singleton target while preserving section deep-link", () => {
    const resolved = resolveShellRouteEntry("/app/explorer", "?section=overflow");

    expect(resolved).not.toBeNull();
    expect(resolved?.app.appId).toBe("explorer");
    expect(resolved?.target).toEqual({
      key: "explorer",
      title: "Explorer",
      routePath: "/app/explorer?section=overflow",
    });
  });

  it("maps explorer folder route to the same canonical singleton target", () => {
    const resolved = resolveShellRouteEntry("/app/explorer", "?folder=folder-7");

    expect(resolved).not.toBeNull();
    expect(resolved?.app.appId).toBe("explorer");
    expect(resolved?.target).toEqual({
      key: "explorer",
      title: "Explorer",
      routePath: "/app/explorer?folder=folder-7",
    });
  });
});

describe("chat route builders", () => {
  it("preserves extra direct chat params while normalizing chat identity", () => {
    const params = new URLSearchParams({
      message: "message-1",
      from: "search",
    });

    expect(buildDirectChatRoutePath("chat-9", params)).toBe(
      "/app/chats?message=message-1&from=search&chat=chat-9",
    );
  });

  it("preserves extra group params while normalizing group identity", () => {
    const params = new URLSearchParams({
      join: "ginv_123",
      from: "invite",
    });

    expect(buildGroupChatRoutePath("group-9", params)).toBe(
      "/app/groups?join=ginv_123&from=invite&group=group-9",
    );
  });

  it("preserves extra person params while normalizing profile identity", () => {
    const params = new URLSearchParams({
      from: "search",
    });

    expect(buildPersonProfileRoutePath("user-9", params)).toBe(
      "/app/people?from=search&person=user-9",
    );
  });

  it("keeps extra friend requests params on the singleton route", () => {
    const params = new URLSearchParams({
      from: "desktop",
    });

    expect(buildFriendRequestsRoutePath(params)).toBe("/app/friend-requests?from=desktop");
  });

  it("keeps extra self chat params on the singleton route", () => {
    const params = new URLSearchParams({
      from: "desktop",
    });

    expect(buildSelfChatRoutePath(params)).toBe("/app/self?from=desktop");
  });

  it("keeps explorer section params on the singleton route", () => {
    const params = new URLSearchParams({
      section: "hidden",
    });

    expect(buildExplorerRoutePath(params)).toBe("/app/explorer?section=hidden");
  });

  it("builds explorer folder route and drops section query in favor of folder target", () => {
    const params = new URLSearchParams({
      section: "hidden",
      from: "desktop",
    });

    expect(buildExplorerFolderRoutePath("folder-4", params)).toBe(
      "/app/explorer?from=desktop&folder=folder-4",
    );
  });
});
