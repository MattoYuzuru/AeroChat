export interface ChatsRouteSyncInput {
  requestedChatId: string;
  requestedPeerUserId: string;
  selectedChatId: string | null;
  pendingPeerUserId: string | null;
}

export type ChatsRouteSyncAction =
  | {
      kind: "idle";
      nextPendingPeerUserId: string | null;
    }
  | {
      kind: "open_chat";
      chatId: string;
      nextPendingPeerUserId: null;
    }
  | {
      kind: "ensure_peer_chat";
      peerUserId: string;
      nextPendingPeerUserId: string;
    };

export function resolveChatsRouteSyncAction(
  input: ChatsRouteSyncInput,
): ChatsRouteSyncAction {
  if (input.requestedChatId !== "") {
    if (input.selectedChatId === input.requestedChatId) {
      return {
        kind: "idle",
        nextPendingPeerUserId: null,
      };
    }

    return {
      kind: "open_chat",
      chatId: input.requestedChatId,
      nextPendingPeerUserId: null,
    };
  }

  if (input.requestedPeerUserId !== "") {
    if (input.pendingPeerUserId === input.requestedPeerUserId) {
      return {
        kind: "idle",
        nextPendingPeerUserId: input.pendingPeerUserId,
      };
    }

    return {
      kind: "ensure_peer_chat",
      peerUserId: input.requestedPeerUserId,
      nextPendingPeerUserId: input.requestedPeerUserId,
    };
  }

  return {
    kind: "idle",
    nextPendingPeerUserId: null,
  };
}
