import type {
  ChatUser,
  DirectChat,
  Group,
  MessageSearchScopeInput,
  MessageSearchScopeKind,
} from "../gateway/types";

export type SearchScopeSelection =
  | "all-direct"
  | "direct"
  | "all-groups"
  | "group";

export type SearchResultLane = "plaintext" | "encrypted";

export interface SearchResultLike {
  scope: MessageSearchScopeKind;
  directChatId: string | null;
  groupId: string | null;
  messageId: string;
  author: ChatUser | null;
  position: {
    messageId: string;
    messageCreatedAt: string;
  } | null;
  lane?: SearchResultLane;
}

export function buildMessageSearchScope(
  selection: SearchScopeSelection,
  directChatId: string,
  groupId: string,
): MessageSearchScopeInput | null {
  switch (selection) {
    case "all-direct":
      return { kind: "direct" };
    case "direct":
      return directChatId.trim() === "" ? null : { kind: "direct", chatId: directChatId.trim() };
    case "all-groups":
      return { kind: "group" };
    case "group":
      return groupId.trim() === "" ? null : { kind: "group", groupId: groupId.trim() };
  }
}

export function buildSearchResultHref(result: SearchResultLike): string {
  const messageId = result.position?.messageId.trim() || result.messageId.trim();
  const params = new URLSearchParams({
    message: messageId,
    from: "search",
  });
  if (result.lane === "encrypted") {
    params.set("lane", "encrypted");
  }

  if (result.scope === "group") {
    if (!result.groupId) {
      return "/app/search";
    }

    params.set("group", result.groupId);
    return `/app/groups?${params.toString()}`;
  }

  if (!result.directChatId) {
    return "/app/search";
  }

  params.set("chat", result.directChatId);
  return `/app/chats?${params.toString()}`;
}

export function describeSearchScope(selection: SearchScopeSelection): string {
  switch (selection) {
    case "all-direct":
      return "Все личные чаты";
    case "direct":
      return "Один личный чат";
    case "all-groups":
      return "Все группы";
    case "group":
      return "Одна группа";
  }
}

export function describeLegacySearchPath(selection: SearchScopeSelection): string {
  switch (selection) {
    case "all-direct":
    case "direct":
      return "Серверный поиск по содержимому legacy direct-сообщений больше не поддерживается.";
    case "all-groups":
    case "group":
      return "Серверный поиск остаётся только для legacy group history в выбранной области.";
  }
}

export function describeLegacySearchEmptyState(selection: SearchScopeSelection): string {
  switch (selection) {
    case "all-direct":
    case "direct":
      return "Legacy direct content search на сервере честно де-скоуплен. Для direct остаётся только локальный encrypted поиск текущей сессии.";
    case "all-groups":
    case "group":
      return "В этой области подходящих сообщений нет.";
  }
}

export function describeSearchResultScope(result: SearchResultLike): string {
  return result.scope === "group" ? "Группа" : "Direct";
}

export function describeDirectChatLabel(
  chat: DirectChat,
  currentUserId: string,
): string {
  const peer = chat.participants.find((participant) => participant.id !== currentUserId) ?? null;
  if (!peer) {
    return "Личный чат";
  }

  return formatUserLabel(peer);
}

export function describeSearchResultContainer(
  result: Pick<SearchResultLike, "scope" | "groupId" | "directChatId">,
  directChats: DirectChat[],
  groups: Group[],
  currentUserId: string,
): string {
  if (result.scope === "group") {
    const group = groups.find((entry) => entry.id === result.groupId) ?? null;
    if (!group) {
      return "Группа";
    }

    return group.name.trim() === "" ? "Группа" : group.name;
  }

  const chat = directChats.find((entry) => entry.id === result.directChatId) ?? null;
  if (!chat) {
    return "Личный чат";
  }

  return describeDirectChatLabel(chat, currentUserId);
}

export function describeSearchResultAuthor(
  author: ChatUser | null,
  currentUserId: string,
): string {
  if (!author) {
    return "Неизвестный автор";
  }

  if (author.id === currentUserId) {
    return "Вы";
  }

  return formatUserLabel(author);
}

function formatUserLabel(user: ChatUser): string {
  const nickname = user.nickname.trim();
  const login = user.login.trim();

  if (nickname !== "" && login !== "") {
    return `${nickname} · @${login}`;
  }

  if (nickname !== "") {
    return nickname;
  }

  if (login !== "") {
    return `@${login}`;
  }

  return "Пользователь";
}
