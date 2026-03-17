import { describe, expect, it } from "vitest";
import {
  DIRECT_CHAT_TYPING_IDLE_TIMEOUT_MS,
  DIRECT_CHAT_TYPING_REFRESH_INTERVAL_MS,
  resolveDirectChatTypingSessionChatId,
} from "./typing";

describe("direct chat typing helpers", () => {
  it("starts typing session only for visible loaded selected thread with local composer text", () => {
    expect(
      resolveDirectChatTypingSessionChatId({
        enabled: true,
        pageVisible: true,
        selectedChatId: "chat-1",
        threadChatId: "chat-1",
        composerText: "hello",
      }),
    ).toBe("chat-1");
    expect(
      resolveDirectChatTypingSessionChatId({
        enabled: true,
        pageVisible: true,
        selectedChatId: "chat-2",
        threadChatId: "chat-1",
        composerText: "hello",
      }),
    ).toBeNull();
    expect(
      resolveDirectChatTypingSessionChatId({
        enabled: true,
        pageVisible: true,
        selectedChatId: "chat-1",
        threadChatId: "chat-1",
        composerText: "   ",
      }),
    ).toBeNull();
  });

  it("uses bounded refresh and idle windows for the alpha typing model", () => {
    expect(DIRECT_CHAT_TYPING_REFRESH_INTERVAL_MS).toBe(2_500);
    expect(DIRECT_CHAT_TYPING_IDLE_TIMEOUT_MS).toBe(3_500);
  });
});
