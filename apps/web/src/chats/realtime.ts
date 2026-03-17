import type {
  DirectChat,
  DirectChatMessage,
  DirectChatPresenceState,
  DirectChatReadPosition,
  DirectChatReadState,
  DirectChatTypingState,
} from "../gateway/types";
import type { RealtimeEnvelope } from "../realtime/client";
import { createReadState } from "./state";

interface ChatUserWire {
  id?: string;
  login?: string;
  nickname?: string;
  avatarUrl?: string;
}

interface DirectChatWire {
  id?: string;
  kind?: string;
  participants?: ChatUserWire[];
  pinnedMessageIds?: string[];
  createdAt?: string;
  updatedAt?: string;
}

interface TextMessageContentWire {
  text?: string;
  markdownPolicy?: string;
}

interface MessageTombstoneWire {
  deletedByUserId?: string;
  deletedAt?: string;
}

interface DirectChatMessageWire {
  id?: string;
  chatId?: string;
  senderUserId?: string;
  kind?: string;
  text?: TextMessageContentWire;
  tombstone?: MessageTombstoneWire;
  pinned?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface DirectChatReadPositionWire {
  messageId?: string;
  messageCreatedAt?: string;
  updatedAt?: string;
}

interface DirectChatReadStateWire {
  selfPosition?: DirectChatReadPositionWire;
  peerPosition?: DirectChatReadPositionWire;
}

interface DirectChatMessageUpdatedPayloadWire {
  reason?: string;
  chat?: DirectChatWire;
  message?: DirectChatMessageWire;
}

interface DirectChatReadUpdatedPayloadWire {
  chatId?: string;
  readState?: DirectChatReadStateWire;
}

interface DirectChatTypingIndicatorWire {
  updatedAt?: string;
  expiresAt?: string;
}

interface DirectChatTypingStateWire {
  selfTyping?: DirectChatTypingIndicatorWire;
  peerTyping?: DirectChatTypingIndicatorWire;
}

interface DirectChatTypingUpdatedPayloadWire {
  chatId?: string;
  typingState?: DirectChatTypingStateWire;
}

interface DirectChatPresenceIndicatorWire {
  heartbeatAt?: string;
  expiresAt?: string;
}

interface DirectChatPresenceStateWire {
  selfPresence?: DirectChatPresenceIndicatorWire;
  peerPresence?: DirectChatPresenceIndicatorWire;
}

interface DirectChatPresenceUpdatedPayloadWire {
  chatId?: string;
  presenceState?: DirectChatPresenceStateWire;
}

export type DirectChatRealtimeEvent =
  | {
      type: "direct_chat.message.updated";
      reason: string;
      chat: DirectChat;
      message: DirectChatMessage;
    }
  | {
      type: "direct_chat.read.updated";
      chatId: string;
      readState: DirectChatReadState | null;
    }
  | {
      type: "direct_chat.typing.updated";
      chatId: string;
      typingState: DirectChatTypingState | null;
    }
  | {
      type: "direct_chat.presence.updated";
      chatId: string;
      presenceState: DirectChatPresenceState | null;
    };

export function parseDirectChatRealtimeEvent(
  envelope: RealtimeEnvelope,
): DirectChatRealtimeEvent | null {
  if (envelope.type === "direct_chat.message.updated") {
    const payload = normalizeMessageUpdatedPayload(envelope.payload);
    if (!payload) {
      return null;
    }

    return {
      type: "direct_chat.message.updated",
      reason: payload.reason,
      chat: payload.chat,
      message: payload.message,
    };
  }

  if (envelope.type === "direct_chat.read.updated") {
    const payload = normalizeReadUpdatedPayload(envelope.payload);
    if (!payload) {
      return null;
    }

    return {
      type: "direct_chat.read.updated",
      chatId: payload.chatId,
      readState: payload.readState,
    };
  }

  if (envelope.type === "direct_chat.typing.updated") {
    const payload = normalizeTypingUpdatedPayload(envelope.payload);
    if (!payload) {
      return null;
    }

    return {
      type: "direct_chat.typing.updated",
      chatId: payload.chatId,
      typingState: payload.typingState,
    };
  }

  if (envelope.type === "direct_chat.presence.updated") {
    const payload = normalizePresenceUpdatedPayload(envelope.payload);
    if (!payload) {
      return null;
    }

    return {
      type: "direct_chat.presence.updated",
      chatId: payload.chatId,
      presenceState: payload.presenceState,
    };
  }

  return null;
}

function normalizeMessageUpdatedPayload(
  input: unknown,
): {
  reason: string;
  chat: DirectChat;
  message: DirectChatMessage;
} | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const payload = input as DirectChatMessageUpdatedPayloadWire;
  const chat = normalizeDirectChat(payload.chat);
  const message = normalizeDirectChatMessage(payload.message);
  const reason = typeof payload.reason === "string" ? payload.reason : "";
  if (chat.id === "" || message.id === "" || message.chatId === "" || reason === "") {
    return null;
  }

  return {
    reason,
    chat,
    message,
  };
}

function normalizeReadUpdatedPayload(
  input: unknown,
): {
  chatId: string;
  readState: DirectChatReadState | null;
} | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const payload = input as DirectChatReadUpdatedPayloadWire;
  const chatId = typeof payload.chatId === "string" ? payload.chatId : "";
  if (chatId === "") {
    return null;
  }

  return {
    chatId,
    readState: normalizeReadState(payload.readState),
  };
}

function normalizeTypingUpdatedPayload(
  input: unknown,
): {
  chatId: string;
  typingState: DirectChatTypingState | null;
} | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const payload = input as DirectChatTypingUpdatedPayloadWire;
  const chatId = typeof payload.chatId === "string" ? payload.chatId : "";
  if (chatId === "") {
    return null;
  }

  return {
    chatId,
    typingState: normalizeTypingState(payload.typingState),
  };
}

function normalizePresenceUpdatedPayload(
  input: unknown,
): {
  chatId: string;
  presenceState: DirectChatPresenceState | null;
} | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const payload = input as DirectChatPresenceUpdatedPayloadWire;
  const chatId = typeof payload.chatId === "string" ? payload.chatId : "";
  if (chatId === "") {
    return null;
  }

  return {
    chatId,
    presenceState: normalizePresenceState(payload.presenceState),
  };
}

function normalizeDirectChat(input: DirectChatWire | undefined): DirectChat {
  return {
    id: input?.id ?? "",
    kind: input?.kind ?? "CHAT_KIND_UNSPECIFIED",
    participants: (input?.participants ?? []).map((participant) => ({
      id: participant?.id ?? "",
      login: participant?.login ?? "",
      nickname: participant?.nickname ?? "",
      avatarUrl: normalizeNullableString(participant?.avatarUrl),
    })),
    pinnedMessageIds: (input?.pinnedMessageIds ?? []).filter(
      (value): value is string => typeof value === "string" && value.trim() !== "",
    ),
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
  };
}

function normalizeDirectChatMessage(
  input: DirectChatMessageWire | undefined,
): DirectChatMessage {
  return {
    id: input?.id ?? "",
    chatId: input?.chatId ?? "",
    senderUserId: input?.senderUserId ?? "",
    kind: input?.kind ?? "MESSAGE_KIND_UNSPECIFIED",
    text: normalizeTextMessageContent(input?.text),
    tombstone: normalizeMessageTombstone(input?.tombstone),
    pinned: input?.pinned ?? false,
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
  };
}

function normalizeTextMessageContent(
  input: TextMessageContentWire | undefined,
) {
  if (!input) {
    return null;
  }

  return {
    text: input.text ?? "",
    markdownPolicy: input.markdownPolicy ?? "MARKDOWN_POLICY_UNSPECIFIED",
  };
}

function normalizeMessageTombstone(input: MessageTombstoneWire | undefined) {
  if (!input) {
    return null;
  }

  const deletedByUserId = input.deletedByUserId ?? "";
  const deletedAt = input.deletedAt ?? "";
  if (deletedByUserId === "" && deletedAt === "") {
    return null;
  }

  return {
    deletedByUserId,
    deletedAt,
  };
}

function normalizeReadState(
  input: DirectChatReadStateWire | undefined,
): DirectChatReadState | null {
  return createReadState(
    normalizeReadPosition(input?.selfPosition),
    normalizeReadPosition(input?.peerPosition),
  );
}

function normalizeReadPosition(
  input: DirectChatReadPositionWire | undefined,
): DirectChatReadPosition | null {
  if (!input) {
    return null;
  }

  const messageId = input.messageId ?? "";
  const messageCreatedAt = input.messageCreatedAt ?? "";
  const updatedAt = input.updatedAt ?? "";
  if (messageId === "" && messageCreatedAt === "" && updatedAt === "") {
    return null;
  }

  return {
    messageId,
    messageCreatedAt,
    updatedAt,
  };
}

function normalizeTypingState(
  input: DirectChatTypingStateWire | undefined,
): DirectChatTypingState | null {
  if (!input) {
    return null;
  }

  const selfTyping = normalizeTypingIndicator(input.selfTyping);
  const peerTyping = normalizeTypingIndicator(input.peerTyping);
  if (!selfTyping && !peerTyping) {
    return null;
  }

  return {
    selfTyping,
    peerTyping,
  };
}

function normalizeTypingIndicator(
  input: DirectChatTypingIndicatorWire | undefined,
) {
  if (!input) {
    return null;
  }

  const updatedAt = input.updatedAt ?? "";
  const expiresAt = input.expiresAt ?? "";
  if (updatedAt === "" && expiresAt === "") {
    return null;
  }

  return {
    updatedAt,
    expiresAt,
  };
}

function normalizePresenceState(
  input: DirectChatPresenceStateWire | undefined,
): DirectChatPresenceState | null {
  if (!input) {
    return null;
  }

  const selfPresence = normalizePresenceIndicator(input.selfPresence);
  const peerPresence = normalizePresenceIndicator(input.peerPresence);
  if (!selfPresence && !peerPresence) {
    return null;
  }

  return {
    selfPresence,
    peerPresence,
  };
}

function normalizePresenceIndicator(
  input: DirectChatPresenceIndicatorWire | undefined,
) {
  if (!input) {
    return null;
  }

  const heartbeatAt = input.heartbeatAt ?? "";
  const expiresAt = input.expiresAt ?? "";
  if (heartbeatAt === "" && expiresAt === "") {
    return null;
  }

  return {
    heartbeatAt,
    expiresAt,
  };
}

function normalizeNullableString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value === "" ? null : value;
}
