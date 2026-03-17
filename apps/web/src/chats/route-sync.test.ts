import { describe, expect, it } from "vitest";
import { resolveChatsRouteSyncAction } from "./route-sync";

describe("resolveChatsRouteSyncAction", () => {
  it("does not reopen an already selected chat", () => {
    expect(
      resolveChatsRouteSyncAction({
        requestedChatId: "chat-1",
        requestedPeerUserId: "",
        selectedChatId: "chat-1",
        pendingPeerUserId: null,
      }),
    ).toEqual({
      kind: "idle",
      nextPendingPeerUserId: null,
    });
  });

  it("opens a chat when route points to a different thread", () => {
    expect(
      resolveChatsRouteSyncAction({
        requestedChatId: "chat-2",
        requestedPeerUserId: "",
        selectedChatId: "chat-1",
        pendingPeerUserId: null,
      }),
    ).toEqual({
      kind: "open_chat",
      chatId: "chat-2",
      nextPendingPeerUserId: null,
    });
  });

  it("does not recreate peer chat resolution while the same peer is already pending", () => {
    expect(
      resolveChatsRouteSyncAction({
        requestedChatId: "",
        requestedPeerUserId: "user-2",
        selectedChatId: null,
        pendingPeerUserId: "user-2",
      }),
    ).toEqual({
      kind: "idle",
      nextPendingPeerUserId: "user-2",
    });
  });

  it("starts peer chat resolution only for a new peer request", () => {
    expect(
      resolveChatsRouteSyncAction({
        requestedChatId: "",
        requestedPeerUserId: "user-3",
        selectedChatId: null,
        pendingPeerUserId: "user-2",
      }),
    ).toEqual({
      kind: "ensure_peer_chat",
      peerUserId: "user-3",
      nextPendingPeerUserId: "user-3",
    });
  });
});
