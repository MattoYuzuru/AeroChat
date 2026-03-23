import { describe, expect, it } from "vitest";
import { isDirectAudioCallSupportedForChatKind } from "./useDirectCallSession";

describe("direct audio call scope guard", () => {
  it("enables the call surface only for direct chats", () => {
    expect(isDirectAudioCallSupportedForChatKind("CHAT_KIND_DIRECT")).toBe(true);
    expect(isDirectAudioCallSupportedForChatKind("CHAT_KIND_GROUP")).toBe(false);
    expect(isDirectAudioCallSupportedForChatKind("group")).toBe(false);
  });
});
