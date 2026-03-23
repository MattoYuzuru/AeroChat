import type {
  RtcCall,
  RtcCallParticipant,
  RtcConversationScope,
  RtcSignalEnvelope,
} from "../gateway/types";
import type { RealtimeEnvelope } from "../realtime/client";

interface RTCScopeWire {
  type?: string;
  directChatId?: string;
  groupId?: string;
}

interface RTCCallWire {
  id?: string;
  scope?: RTCScopeWire;
  createdByUserId?: string;
  status?: string;
  activeParticipantCount?: number | string;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  endedAt?: string;
  endedByUserId?: string;
  endReason?: string;
}

interface RTCParticipantWire {
  id?: string;
  callId?: string;
  userId?: string;
  state?: string;
  joinedAt?: string;
  leftAt?: string;
  updatedAt?: string;
  lastSignalAt?: string;
}

interface RTCSignalWire {
  callId?: string;
  fromUserId?: string;
  targetUserId?: string;
  type?: string;
  payload?: string;
  createdAt?: string;
}

interface RTCCallUpdatedPayloadWire {
  call?: RTCCallWire;
}

interface RTCParticipantUpdatedPayloadWire {
  callId?: string;
  participant?: RTCParticipantWire;
}

interface RTCSignalReceivedPayloadWire {
  signal?: RTCSignalWire;
}

export type RTCRealtimeEvent =
  | {
      type: "rtc.call.updated";
      call: RtcCall;
    }
  | {
      type: "rtc.participant.updated";
      callId: string;
      participant: RtcCallParticipant;
    }
  | {
      type: "rtc.signal.received";
      signal: RtcSignalEnvelope;
    };

export function parseRTCRealtimeEvent(
  envelope: RealtimeEnvelope,
): RTCRealtimeEvent | null {
  if (envelope.type === "rtc.call.updated") {
    const payload = normalizeRTCCallUpdatedPayload(envelope.payload);
    if (!payload) {
      return null;
    }

    return {
      type: "rtc.call.updated",
      call: payload.call,
    };
  }

  if (envelope.type === "rtc.participant.updated") {
    const payload = normalizeRTCParticipantUpdatedPayload(envelope.payload);
    if (!payload) {
      return null;
    }

    return {
      type: "rtc.participant.updated",
      callId: payload.callId,
      participant: payload.participant,
    };
  }

  if (envelope.type === "rtc.signal.received") {
    const payload = normalizeRTCSignalReceivedPayload(envelope.payload);
    if (!payload) {
      return null;
    }

    return {
      type: "rtc.signal.received",
      signal: payload.signal,
    };
  }

  return null;
}

function normalizeRTCCallUpdatedPayload(
  input: unknown,
): { call: RtcCall } | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const payload = input as RTCCallUpdatedPayloadWire;
  const call = normalizeRTCCall(payload.call);
  if (call === null) {
    return null;
  }

  return { call };
}

function normalizeRTCParticipantUpdatedPayload(
  input: unknown,
): { callId: string; participant: RtcCallParticipant } | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const payload = input as RTCParticipantUpdatedPayloadWire;
  const callId = payload.callId?.trim() ?? "";
  const participant = normalizeRTCParticipant(payload.participant);
  if (callId === "" || participant === null) {
    return null;
  }

  return { callId, participant };
}

function normalizeRTCSignalReceivedPayload(
  input: unknown,
): { signal: RtcSignalEnvelope } | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const payload = input as RTCSignalReceivedPayloadWire;
  const signal = normalizeRTCSignal(payload.signal);
  if (signal === null) {
    return null;
  }

  return { signal };
}

function normalizeRTCCall(input: RTCCallWire | undefined): RtcCall | null {
  const id = input?.id?.trim() ?? "";
  if (id === "") {
    return null;
  }

  return {
    id,
    scope: normalizeRTCScope(input?.scope),
    createdByUserId: input?.createdByUserId ?? "",
    status: normalizeRTCCallStatus(input?.status),
    activeParticipantCount: normalizeCount(input?.activeParticipantCount),
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
    startedAt: input?.startedAt ?? "",
    endedAt: normalizeNullableString(input?.endedAt),
    endedByUserId: normalizeNullableString(input?.endedByUserId),
    endReason: normalizeRTCCallEndReason(input?.endReason),
  };
}

function normalizeRTCParticipant(
  input: RTCParticipantWire | undefined,
): RtcCallParticipant | null {
  const id = input?.id?.trim() ?? "";
  if (id === "") {
    return null;
  }

  return {
    id,
    callId: input?.callId ?? "",
    userId: input?.userId ?? "",
    state: normalizeRTCParticipantState(input?.state),
    joinedAt: input?.joinedAt ?? "",
    leftAt: normalizeNullableString(input?.leftAt),
    updatedAt: input?.updatedAt ?? "",
    lastSignalAt: normalizeNullableString(input?.lastSignalAt),
  };
}

function normalizeRTCSignal(input: RTCSignalWire | undefined): RtcSignalEnvelope | null {
  const callId = input?.callId?.trim() ?? "";
  const fromUserId = input?.fromUserId?.trim() ?? "";
  const targetUserId = input?.targetUserId?.trim() ?? "";
  if (callId === "" || fromUserId === "" || targetUserId === "") {
    return null;
  }

  return {
    callId,
    fromUserId,
    targetUserId,
    type: normalizeRTCSignalType(input?.type),
    payload: decodeBase64ToBytes(input?.payload ?? ""),
    createdAt: input?.createdAt ?? "",
  };
}

function normalizeRTCScope(input: RTCScopeWire | undefined): RtcConversationScope {
  return {
    kind: normalizeRTCScopeType(input?.type),
    directChatId: normalizeNullableString(input?.directChatId),
    groupId: normalizeNullableString(input?.groupId),
  };
}

function normalizeRTCScopeType(value: string | undefined): RtcConversationScope["kind"] {
  switch (value) {
    case "CONVERSATION_SCOPE_TYPE_GROUP":
    case "group":
      return "group";
    case "CONVERSATION_SCOPE_TYPE_DIRECT":
    case "direct":
    default:
      return "direct";
  }
}

function normalizeRTCCallStatus(value: string | undefined): RtcCall["status"] {
  switch (value) {
    case "CALL_STATUS_ENDED":
    case "ended":
      return "ended";
    case "CALL_STATUS_ACTIVE":
    case "active":
    default:
      return "active";
  }
}

function normalizeRTCCallEndReason(value: string | undefined): RtcCall["endReason"] {
  switch (value) {
    case "CALL_END_REASON_MANUAL":
    case "manual":
      return "manual";
    case "CALL_END_REASON_LAST_PARTICIPANT_LEFT":
    case "last_participant_left":
      return "last_participant_left";
    default:
      return "unspecified";
  }
}

function normalizeRTCParticipantState(value: string | undefined): RtcCallParticipant["state"] {
  switch (value) {
    case "PARTICIPANT_STATE_LEFT":
    case "left":
      return "left";
    case "PARTICIPANT_STATE_ACTIVE":
    case "active":
    default:
      return "active";
  }
}

function normalizeRTCSignalType(value: string | undefined): RtcSignalEnvelope["type"] {
  switch (value) {
    case "SIGNAL_ENVELOPE_TYPE_ANSWER":
    case "answer":
      return "answer";
    case "SIGNAL_ENVELOPE_TYPE_ICE_CANDIDATE":
    case "ice_candidate":
      return "ice_candidate";
    case "SIGNAL_ENVELOPE_TYPE_OFFER":
    case "offer":
    default:
      return "offer";
  }
}

function normalizeCount(value: number | string | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function normalizeNullableString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value === "" ? null : value;
}

function decodeBase64ToBytes(value: string): Uint8Array {
  if (typeof value !== "string" || value.trim() === "") {
    return new Uint8Array(0);
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
