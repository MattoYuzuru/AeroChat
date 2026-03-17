import { describe, expect, it } from "vitest";
import {
  DIRECT_CHAT_PRESENCE_HEARTBEAT_INTERVAL_MS,
  resolveDirectChatPresenceHeartbeatChatId,
} from "./presence";

describe("direct chat presence helpers", () => {
  it("starts heartbeat only for visible loaded selected thread", () => {
    expect(
      resolveDirectChatPresenceHeartbeatChatId({
        enabled: true,
        pageVisible: true,
        selectedChatId: "chat-1",
        threadChatId: "chat-1",
      }),
    ).toBe("chat-1");
    expect(
      resolveDirectChatPresenceHeartbeatChatId({
        enabled: true,
        pageVisible: true,
        selectedChatId: "chat-2",
        threadChatId: "chat-1",
      }),
    ).toBeNull();
    expect(
      resolveDirectChatPresenceHeartbeatChatId({
        enabled: true,
        pageVisible: false,
        selectedChatId: "chat-1",
        threadChatId: "chat-1",
      }),
    ).toBeNull();
  });

  it("uses bounded heartbeat interval for current alpha", () => {
    expect(DIRECT_CHAT_PRESENCE_HEARTBEAT_INTERVAL_MS).toBe(20_000);
  });
});
