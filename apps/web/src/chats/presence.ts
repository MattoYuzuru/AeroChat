export const DIRECT_CHAT_PRESENCE_HEARTBEAT_INTERVAL_MS = 20_000;

interface ResolveDirectChatPresenceHeartbeatChatIdInput {
  enabled: boolean;
  pageVisible: boolean;
  selectedChatId: string | null;
  threadChatId: string | null;
}

// Heartbeat живёт только пока открыт тот же thread, который реально загружен в UI.
export function resolveDirectChatPresenceHeartbeatChatId(
  input: ResolveDirectChatPresenceHeartbeatChatIdInput,
): string | null {
  if (!input.enabled || !input.pageVisible) {
    return null;
  }

  const selectedChatId = input.selectedChatId?.trim() ?? "";
  const threadChatId = input.threadChatId?.trim() ?? "";
  if (selectedChatId === "" || threadChatId === "") {
    return null;
  }

  return selectedChatId === threadChatId ? threadChatId : null;
}
