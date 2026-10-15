import type { GroupMemberRole } from "../gateway/types";
import type { GroupCallAwarenessEntry } from "./group-awareness";
import { canActivelyParticipateInGroupCall } from "./group-call-state";

export interface GroupLobbyOwnership {
  groupId: string;
  callId: string;
  userId: string;
}

export const groupLobbyHeartbeatIntervalMs = 20_000;

export function selectOwnedGroupLobbyCallId(input: {
  ownership: GroupLobbyOwnership | null;
  entry: GroupCallAwarenessEntry | null;
  currentUserId: string;
  selfRole: GroupMemberRole | null;
}): string | null {
  const { ownership, entry } = input;
  if (
    ownership === null || entry === null || input.selfRole === null ||
    ownership.userId !== input.currentUserId ||
    !canActivelyParticipateInGroupCall(input.selfRole) ||
    entry.groupId !== ownership.groupId || entry.call.id !== ownership.callId ||
    entry.call.scope.kind !== "group" || entry.call.scope.groupId !== ownership.groupId ||
    entry.call.status !== "active" ||
    !entry.participants.some(participant => participant.userId === input.currentUserId && participant.state === "active")
  ) return null;
  return ownership.callId;
}

export function startGroupLobbyHeartbeat(input: {
  touch(): Promise<unknown>;
  onSuccess(): void;
  onFailure(error: unknown): void;
}): () => void {
  let disposed = false;
  let inFlight = false;
  const heartbeat = async () => {
    if (disposed || inFlight) return;
    inFlight = true;
    try {
      await input.touch();
      if (!disposed) input.onSuccess();
    } catch (error) {
      if (!disposed) input.onFailure(error);
    } finally {
      inFlight = false;
    }
  };
  void heartbeat();
  const interval = setInterval(() => { void heartbeat(); }, groupLobbyHeartbeatIntervalMs);
  return () => { disposed = true; clearInterval(interval); };
}
