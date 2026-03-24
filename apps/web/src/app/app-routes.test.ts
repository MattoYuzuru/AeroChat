import { describe, expect, it } from "vitest";
import {
  buildDirectChatRoutePath,
  buildGroupChatRoutePath,
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
});
