import type { ChatUser, DirectChat } from "../gateway/types";

export function isSelfDirectChat(
  chat: DirectChat,
  currentUserId: string,
): boolean {
  return chat.participants.length === 1 && chat.participants[0]?.id === currentUserId;
}

export function findSelfDirectChat(
  chats: DirectChat[],
  currentUserId: string,
): DirectChat | null {
  return chats.find((chat) => isSelfDirectChat(chat, currentUserId)) ?? null;
}

export function getDirectChatPeerOrSelf(
  chat: DirectChat,
  currentUserId: string,
): ChatUser | null {
  const peer =
    chat.participants.find((participant) => participant.id !== currentUserId) ?? null;
  if (peer !== null) {
    return peer;
  }
  if (isSelfDirectChat(chat, currentUserId)) {
    return chat.participants[0] ?? null;
  }

  return null;
}
