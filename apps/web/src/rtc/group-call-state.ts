import type {
  GroupMemberRole,
  RtcCall,
  RtcCallParticipant,
} from "../gateway/types";

export type GroupCallActionState =
  | "idle"
  | "starting"
  | "joining"
  | "leaving"
  | "ending";

export type GroupCallTerminalState = "idle" | "ended" | "failed";

export type GroupCallUiPhase =
  | "no_active_call"
  | "starting"
  | "active"
  | "joined"
  | "observing"
  | "ending"
  | "ended"
  | "failed";

export interface GroupCallActionAvailability {
  canStart: boolean;
  canJoin: boolean;
  canLeave: boolean;
  canEnd: boolean;
  isReadOnly: boolean;
}

export function canActivelyParticipateInGroupCall(role: GroupMemberRole): boolean {
  return role === "owner" || role === "admin" || role === "member";
}

export function deriveGroupCallActionAvailability(input: {
  actionState: GroupCallActionState;
  call: RtcCall | null;
  currentUserId: string;
  selfParticipant: RtcCallParticipant | null;
  selfRole: GroupMemberRole;
}): GroupCallActionAvailability {
  const isReadOnly = !canActivelyParticipateInGroupCall(input.selfRole);
  const actionIdle = input.actionState === "idle";

  return {
    canStart: actionIdle && !isReadOnly && input.call === null,
    canJoin: actionIdle && !isReadOnly && input.call !== null && input.selfParticipant === null,
    canLeave: actionIdle && input.call !== null && input.selfParticipant !== null,
    canEnd:
      actionIdle &&
      !isReadOnly &&
      input.call !== null &&
      input.call.createdByUserId === input.currentUserId,
    isReadOnly,
  };
}

export function deriveGroupCallUiPhase(input: {
  actionState: GroupCallActionState;
  call: RtcCall | null;
  selfParticipant: RtcCallParticipant | null;
  terminalState: GroupCallTerminalState;
}): GroupCallUiPhase {
  if (input.actionState === "starting" || input.actionState === "joining") {
    return "starting";
  }

  if (input.actionState === "leaving" || input.actionState === "ending") {
    return "ending";
  }

  if (input.terminalState === "failed") {
    return "failed";
  }

  if (input.terminalState === "ended") {
    return "ended";
  }

  if (input.call === null) {
    return "no_active_call";
  }

  if (input.selfParticipant !== null) {
    return "joined";
  }

  return input.call.status === "active" ? "observing" : "active";
}

export function describeGroupCallConflictMessage(
  action: "start" | "join",
): string {
  if (action === "start") {
    return "Нельзя начать групповой звонок, пока вы уже участвуете в другом активном звонке.";
  }

  return "Нельзя присоединиться к групповому звонку, пока вы уже участвуете в другом активном звонке.";
}
