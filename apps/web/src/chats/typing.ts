export const DIRECT_CHAT_TYPING_REFRESH_INTERVAL_MS = 2_500;
export const DIRECT_CHAT_TYPING_IDLE_TIMEOUT_MS = 3_500;

interface ResolveDirectChatTypingSessionChatIdInput {
  enabled: boolean;
  pageVisible: boolean;
  selectedChatId: string | null;
  threadChatId: string | null;
  composerText: string;
}

// Typing живёт только для загруженного выбранного thread и только пока в composer есть локальный текст.
export function resolveDirectChatTypingSessionChatId(
  input: ResolveDirectChatTypingSessionChatIdInput,
): string | null {
  if (!input.enabled || !input.pageVisible) {
    return null;
  }

  if (input.composerText.trim() === "") {
    return null;
  }

  const selectedChatId = input.selectedChatId?.trim() ?? "";
  const threadChatId = input.threadChatId?.trim() ?? "";
  if (selectedChatId === "" || threadChatId === "") {
    return null;
  }

  return selectedChatId === threadChatId ? threadChatId : null;
}
