import type {
  DirectChat,
  DirectChatMessage,
  DirectChatReadPosition,
  DirectChatReadState,
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

function normalizeNullableString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value === "" ? null : value;
}
