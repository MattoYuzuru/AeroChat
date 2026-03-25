import {
  buildDirectChatRoutePath,
  buildPersonProfileRoutePath,
} from "../app/app-routes";
import { gatewayClient } from "../gateway/runtime";
import { isGatewayErrorCode, type DirectChat } from "../gateway/types";

export type PersonSurfaceSource = "people" | "requests" | "search";

export interface PersonProfileNavigationIntent {
  routePath: string;
  shellOptions: {
    userId: string;
    title?: string;
    searchParams?: URLSearchParams | null;
  };
}

export interface DirectChatNavigationIntent {
  routePath: string;
  shellOptions: {
    chatId: string;
    title?: string;
    searchParams?: URLSearchParams | null;
  };
}

export function buildPersonProfileNavigationIntent({
  userId,
  title,
  source = "people",
}: {
  userId: string;
  title?: string;
  source?: PersonSurfaceSource;
}): PersonProfileNavigationIntent {
  const searchParams = buildPersonSurfaceSearchParams(source);

  return {
    routePath: buildPersonProfileRoutePath(userId, searchParams),
    shellOptions: {
      userId,
      title,
      searchParams,
    },
  };
}

export function buildDirectChatNavigationIntent({
  chatId,
  title,
  searchParams,
}: {
  chatId: string;
  title?: string;
  searchParams?: URLSearchParams | null;
}): DirectChatNavigationIntent {
  return {
    routePath: buildDirectChatRoutePath(chatId, searchParams),
    shellOptions: {
      chatId,
      title,
      searchParams,
    },
  };
}

export async function ensureDirectChatForPeer(
  token: string,
  peerUserId: string,
): Promise<DirectChat> {
  const normalizedPeerUserId = peerUserId.trim();
  if (normalizedPeerUserId === "") {
    throw new Error("Не удалось определить собеседника для открытия личного чата.");
  }

  const currentChats = await gatewayClient.listDirectChats(token);
  const existingChat = findDirectChatByPeerUserId(currentChats, normalizedPeerUserId);
  if (existingChat !== null) {
    return existingChat;
  }

  try {
    return await gatewayClient.createDirectChat(token, normalizedPeerUserId);
  } catch (error) {
    if (!isGatewayErrorCode(error, "already_exists")) {
      throw error;
    }
  }

  const refreshedChats = await gatewayClient.listDirectChats(token);
  const resolvedChat = findDirectChatByPeerUserId(refreshedChats, normalizedPeerUserId);
  if (resolvedChat !== null) {
    return resolvedChat;
  }

  throw new Error("Не удалось открыть личный чат для выбранного контакта.");
}

export function findDirectChatByPeerUserId(
  chats: DirectChat[],
  peerUserId: string,
): DirectChat | null {
  return (
    chats.find((chat) =>
      chat.participants.some((participant) => participant.id === peerUserId),
    ) ?? null
  );
}

function buildPersonSurfaceSearchParams(
  source: PersonSurfaceSource,
): URLSearchParams | null {
  if (source === "people") {
    return null;
  }

  return new URLSearchParams({
    from: source,
  });
}
