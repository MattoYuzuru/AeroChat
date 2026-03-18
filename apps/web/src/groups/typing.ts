import type { GroupTypingState } from "../gateway/types";

export const GROUP_TYPING_REFRESH_INTERVAL_MS = 2_500;
export const GROUP_TYPING_IDLE_TIMEOUT_MS = 3_500;

interface ResolveGroupTypingSessionInput {
  enabled: boolean;
  pageVisible: boolean;
  selectedGroupId: string | null;
  snapshotGroupId: string | null;
  threadId: string | null;
  canSendMessages: boolean;
  composerText: string;
}

export interface GroupTypingSessionTarget {
  groupId: string;
  threadId: string;
}

// Group typing живёт только для открытой текущей thread и только пока локальный composer не пустой.
export function resolveGroupTypingSessionTarget(
  input: ResolveGroupTypingSessionInput,
): GroupTypingSessionTarget | null {
  if (!input.enabled || !input.pageVisible || !input.canSendMessages) {
    return null;
  }

  if (input.composerText.trim() === "") {
    return null;
  }

  const selectedGroupId = input.selectedGroupId?.trim() ?? "";
  const snapshotGroupId = input.snapshotGroupId?.trim() ?? "";
  const threadId = input.threadId?.trim() ?? "";
  if (selectedGroupId === "" || snapshotGroupId === "" || threadId === "") {
    return null;
  }
  if (selectedGroupId !== snapshotGroupId) {
    return null;
  }

  return {
    groupId: snapshotGroupId,
    threadId,
  };
}

export function describeGroupTypingLabel(
  typingState: GroupTypingState | null,
  currentUserId: string,
): string | null {
  const visibleUsers = (typingState?.typers ?? [])
    .map((indicator) => indicator.user)
    .filter((user) => user.id !== currentUserId);
  if (visibleUsers.length === 0) {
    return null;
  }

  const names = visibleUsers.map((user) => user.nickname.trim() || user.login.trim() || "Кто-то");
  if (names.length === 1) {
    return `${names[0]} печатает`;
  }
  if (names.length === 2) {
    return `${names[0]} и ${names[1]} печатают`;
  }

  return `${names[0]}, ${names[1]} и ещё ${names.length - 2} печатают`;
}
