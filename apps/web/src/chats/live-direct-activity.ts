import type { EncryptedDirectMessageV2RealtimeEvent } from "./encrypted-v2-realtime";
import type { DirectChat } from "../gateway/types";

export function patchLiveEncryptedDirectChatActivity(
  chats: DirectChat[],
  event: EncryptedDirectMessageV2RealtimeEvent,
): DirectChat[] {
  const existingChat = chats.find((chat) => chat.id === event.envelope.chatId) ?? null;
  if (existingChat === null) {
    return chats;
  }

  const nextChat: DirectChat = {
    ...existingChat,
    updatedAt:
      event.envelope.storedAt > existingChat.updatedAt
        ? event.envelope.storedAt
        : existingChat.updatedAt,
    encryptedUnreadCount:
      event.envelope.viewerDelivery.unreadState?.unreadCount ??
      existingChat.encryptedUnreadCount,
  };

  const nextChats = chats.filter((chat) => chat.id !== nextChat.id);
  nextChats.push(nextChat);
  nextChats.sort(compareDirectChatsByUpdatedAtDesc);

  return nextChats;
}

function compareDirectChatsByUpdatedAtDesc(left: DirectChat, right: DirectChat): number {
  if (left.updatedAt === right.updatedAt) {
    return left.id.localeCompare(right.id);
  }

  return right.updatedAt.localeCompare(left.updatedAt);
}
