import type {
  Attachment,
  Group,
  GroupChatThread,
  GroupMember,
  GroupMemberRole,
  GroupMessage,
  GroupReadPosition,
  GroupReadState,
  GroupTypingIndicator,
  GroupTypingState,
  TextMessageContent,
} from "../gateway/types";
import type { RealtimeEnvelope } from "../realtime/client";

interface GroupWire {
  id?: string;
  name?: string;
  kind?: string;
  selfRole?: string;
  memberCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

interface GroupThreadWire {
  id?: string;
  groupId?: string;
  threadKey?: string;
  canSendMessages?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface ChatUserWire {
  id?: string;
  login?: string;
  nickname?: string;
  avatarUrl?: string;
}

interface GroupMemberWire {
  user?: ChatUserWire;
  role?: string;
  joinedAt?: string;
}

interface TextMessageContentWire {
  text?: string;
  markdownPolicy?: string;
}

interface AttachmentWire {
  id?: string;
  ownerUserId?: string;
  scope?: string;
  directChatId?: string;
  groupId?: string;
  messageId?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number | string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  uploadedAt?: string;
  attachedAt?: string;
  failedAt?: string;
  deletedAt?: string;
}

interface GroupMessageWire {
  id?: string;
  groupId?: string;
  threadId?: string;
  senderUserId?: string;
  kind?: string;
  text?: TextMessageContentWire;
  attachments?: AttachmentWire[];
  createdAt?: string;
  updatedAt?: string;
  editedAt?: string;
}

interface GroupMessageUpdatedPayloadWire {
  reason?: string;
  group?: GroupWire;
  thread?: GroupThreadWire;
  message?: GroupMessageWire;
}

interface GroupMembershipUpdatedPayloadWire {
  reason?: string;
  groupId?: string;
  group?: GroupWire;
  thread?: GroupThreadWire;
  affectedUserId?: string;
  member?: GroupMemberWire;
  selfMember?: GroupMemberWire;
}

interface GroupRoleUpdatedPayloadWire {
  groupId?: string;
  group?: GroupWire;
  thread?: GroupThreadWire;
  member?: GroupMemberWire;
  selfMember?: GroupMemberWire;
  previousRole?: string;
}

interface GroupOwnershipTransferredPayloadWire {
  groupId?: string;
  group?: GroupWire;
  thread?: GroupThreadWire;
  ownerMember?: GroupMemberWire;
  previousOwnerMember?: GroupMemberWire;
  selfMember?: GroupMemberWire;
}

interface GroupTypingIndicatorWire {
  user?: ChatUserWire;
  updatedAt?: string;
  expiresAt?: string;
}

interface GroupTypingStateWire {
  threadId?: string;
  typers?: GroupTypingIndicatorWire[];
}

interface GroupReadPositionWire {
  messageId?: string;
  messageCreatedAt?: string;
  updatedAt?: string;
}

interface GroupReadStateWire {
  selfPosition?: GroupReadPositionWire;
}

interface UnreadStateWire {
  unreadCount?: number | string;
}

interface GroupTypingUpdatedPayloadWire {
  groupId?: string;
  threadId?: string;
  typingState?: GroupTypingStateWire;
}

interface GroupReadUpdatedPayloadWire {
  groupId?: string;
  readState?: GroupReadStateWire;
  unreadState?: UnreadStateWire;
}

export type GroupMembershipReason =
  | "member_joined"
  | "member_removed"
  | "member_left";

export type GroupRealtimeEvent =
  | {
      type: "group.message.updated";
      reason: string;
      group: Group;
      thread: GroupChatThread;
      message: GroupMessage;
    }
  | {
      type: "group.membership.updated";
      reason: GroupMembershipReason;
      groupId: string;
      group: Group | null;
      thread: GroupChatThread | null;
      affectedUserId: string;
      member: GroupMember | null;
      selfMember: GroupMember | null;
    }
  | {
      type: "group.role.updated";
      groupId: string;
      group: Group | null;
      thread: GroupChatThread | null;
      member: GroupMember;
      selfMember: GroupMember | null;
      previousRole: GroupMemberRole;
    }
  | {
      type: "group.ownership.transferred";
      groupId: string;
      group: Group | null;
      thread: GroupChatThread | null;
      ownerMember: GroupMember;
      previousOwnerMember: GroupMember;
      selfMember: GroupMember | null;
    }
  | {
      type: "group.typing.updated";
      groupId: string;
      threadId: string;
      typingState: GroupTypingState;
    }
  | {
      type: "group.read.updated";
      groupId: string;
      readState: GroupReadState | null;
      unreadCount: number;
    };

export function parseGroupRealtimeEvent(
  envelope: RealtimeEnvelope,
): GroupRealtimeEvent | null {
  if (envelope.type === "group.message.updated") {
    const payload = normalizeMessageUpdatedPayload(envelope.payload);
    if (!payload) {
      return null;
    }

    return {
      type: "group.message.updated",
      reason: payload.reason,
      group: payload.group,
      thread: payload.thread,
      message: payload.message,
    };
  }

  if (envelope.type === "group.membership.updated") {
    const payload = normalizeMembershipUpdatedPayload(envelope.payload);
    if (!payload) {
      return null;
    }

    return {
      type: "group.membership.updated",
      reason: payload.reason,
      groupId: payload.groupId,
      group: payload.group,
      thread: payload.thread,
      affectedUserId: payload.affectedUserId,
      member: payload.member,
      selfMember: payload.selfMember,
    };
  }

  if (envelope.type === "group.role.updated") {
    const payload = normalizeRoleUpdatedPayload(envelope.payload);
    if (!payload) {
      return null;
    }

    return {
      type: "group.role.updated",
      groupId: payload.groupId,
      group: payload.group,
      thread: payload.thread,
      member: payload.member,
      selfMember: payload.selfMember,
      previousRole: payload.previousRole,
    };
  }

  if (envelope.type === "group.ownership.transferred") {
    const payload = normalizeOwnershipTransferredPayload(envelope.payload);
    if (!payload) {
      return null;
    }

    return {
      type: "group.ownership.transferred",
      groupId: payload.groupId,
      group: payload.group,
      thread: payload.thread,
      ownerMember: payload.ownerMember,
      previousOwnerMember: payload.previousOwnerMember,
      selfMember: payload.selfMember,
    };
  }

  if (envelope.type === "group.typing.updated") {
    const payload = normalizeTypingUpdatedPayload(envelope.payload);
    if (!payload) {
      return null;
    }

    return {
      type: "group.typing.updated",
      groupId: payload.groupId,
      threadId: payload.threadId,
      typingState: payload.typingState,
    };
  }

  if (envelope.type === "group.read.updated") {
    const payload = normalizeReadUpdatedPayload(envelope.payload);
    if (!payload) {
      return null;
    }

    return {
      type: "group.read.updated",
      groupId: payload.groupId,
      readState: payload.readState,
      unreadCount: payload.unreadCount,
    };
  }

  return null;
}

function normalizeMessageUpdatedPayload(
  input: unknown,
): {
  reason: string;
  group: Group;
  thread: GroupChatThread;
  message: GroupMessage;
} | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const payload = input as GroupMessageUpdatedPayloadWire;
  const group = normalizeGroup(payload.group);
  const thread = normalizeGroupThread(payload.thread);
  const message = normalizeGroupMessage(payload.message);
  const reason = typeof payload.reason === "string" ? payload.reason : "";
  if (reason === "" || group.id === "" || thread.id === "" || message.id === "") {
    return null;
  }

  return {
    reason,
    group,
    thread,
    message,
  };
}

function normalizeMembershipUpdatedPayload(
  input: unknown,
): {
  reason: GroupMembershipReason;
  groupId: string;
  group: Group | null;
  thread: GroupChatThread | null;
  affectedUserId: string;
  member: GroupMember | null;
  selfMember: GroupMember | null;
} | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const payload = input as GroupMembershipUpdatedPayloadWire;
  const groupId = typeof payload.groupId === "string" ? payload.groupId : "";
  const affectedUserId =
    typeof payload.affectedUserId === "string" ? payload.affectedUserId : "";
  const reason = normalizeMembershipReason(payload.reason);
  if (groupId === "" || affectedUserId === "" || reason === null) {
    return null;
  }

  return {
    reason,
    groupId,
    group: normalizeOptionalGroup(payload.group),
    thread: normalizeOptionalGroupThread(payload.thread),
    affectedUserId,
    member: normalizeOptionalGroupMember(payload.member),
    selfMember: normalizeOptionalGroupMember(payload.selfMember),
  };
}

function normalizeRoleUpdatedPayload(
  input: unknown,
): {
  groupId: string;
  group: Group | null;
  thread: GroupChatThread | null;
  member: GroupMember;
  selfMember: GroupMember | null;
  previousRole: GroupMemberRole;
} | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const payload = input as GroupRoleUpdatedPayloadWire;
  const groupId = typeof payload.groupId === "string" ? payload.groupId : "";
  const member = normalizeOptionalGroupMember(payload.member);
  if (groupId === "" || member === null) {
    return null;
  }

  return {
    groupId,
    group: normalizeOptionalGroup(payload.group),
    thread: normalizeOptionalGroupThread(payload.thread),
    member,
    selfMember: normalizeOptionalGroupMember(payload.selfMember),
    previousRole: normalizeGroupMemberRole(payload.previousRole),
  };
}

function normalizeOwnershipTransferredPayload(
  input: unknown,
): {
  groupId: string;
  group: Group | null;
  thread: GroupChatThread | null;
  ownerMember: GroupMember;
  previousOwnerMember: GroupMember;
  selfMember: GroupMember | null;
} | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const payload = input as GroupOwnershipTransferredPayloadWire;
  const groupId = typeof payload.groupId === "string" ? payload.groupId : "";
  const ownerMember = normalizeOptionalGroupMember(payload.ownerMember);
  const previousOwnerMember = normalizeOptionalGroupMember(
    payload.previousOwnerMember,
  );
  if (groupId === "" || ownerMember === null || previousOwnerMember === null) {
    return null;
  }

  return {
    groupId,
    group: normalizeOptionalGroup(payload.group),
    thread: normalizeOptionalGroupThread(payload.thread),
    ownerMember,
    previousOwnerMember,
    selfMember: normalizeOptionalGroupMember(payload.selfMember),
  };
}

function normalizeTypingUpdatedPayload(
  input: unknown,
): {
  groupId: string;
  threadId: string;
  typingState: GroupTypingState;
} | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const payload = input as GroupTypingUpdatedPayloadWire;
  const groupId = typeof payload.groupId === "string" ? payload.groupId : "";
  const threadId = typeof payload.threadId === "string" ? payload.threadId : "";
  const typingState = normalizeGroupTypingState(payload.typingState);
  if (groupId === "" || threadId === "" || typingState === null || typingState.threadId === "") {
    return null;
  }

  return {
    groupId,
    threadId,
    typingState,
  };
}

function normalizeReadUpdatedPayload(
  input: unknown,
): {
  groupId: string;
  readState: GroupReadState | null;
  unreadCount: number;
} | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const payload = input as GroupReadUpdatedPayloadWire;
  const groupId = typeof payload.groupId === "string" ? payload.groupId : "";
  if (groupId === "") {
    return null;
  }

  return {
    groupId,
    readState: normalizeGroupReadState(payload.readState),
    unreadCount: normalizeUnreadCount(payload.unreadState),
  };
}

function normalizeOptionalGroup(input: GroupWire | undefined): Group | null {
  const group = normalizeGroup(input);
  return group.id === "" ? null : group;
}

function normalizeGroup(input: GroupWire | undefined): Group {
  return {
    id: input?.id ?? "",
    name: input?.name ?? "",
    kind: input?.kind ?? "CHAT_KIND_GROUP",
    selfRole: normalizeGroupMemberRole(input?.selfRole),
    memberCount: input?.memberCount ?? 0,
    unreadCount: 0,
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
  };
}

function normalizeOptionalGroupThread(
  input: GroupThreadWire | undefined,
): GroupChatThread | null {
  const thread = normalizeGroupThread(input);
  return thread.id === "" ? null : thread;
}

function normalizeGroupThread(input: GroupThreadWire | undefined): GroupChatThread {
  return {
    id: input?.id ?? "",
    groupId: input?.groupId ?? "",
    threadKey: input?.threadKey ?? "",
    canSendMessages: input?.canSendMessages ?? false,
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
  };
}

function normalizeOptionalGroupMember(
  input: GroupMemberWire | undefined,
): GroupMember | null {
  if (!input) {
    return null;
  }

  const user = input.user;
  if (!user || typeof user.id !== "string" || user.id === "") {
    return null;
  }

  return {
    user: {
      id: user.id,
      login: normalizeLogin(user.login),
      nickname: user.nickname ?? "",
      avatarUrl: normalizeNullableString(user.avatarUrl),
    },
    role: normalizeGroupMemberRole(input.role),
    joinedAt: input.joinedAt ?? "",
  };
}

function normalizeGroupMessage(input: GroupMessageWire | undefined): GroupMessage {
  return {
    id: input?.id ?? "",
    groupId: input?.groupId ?? "",
    threadId: input?.threadId ?? "",
    senderUserId: input?.senderUserId ?? "",
    kind: input?.kind ?? "MESSAGE_KIND_TEXT",
    text: normalizeTextMessageContent(input?.text),
    attachments: (input?.attachments ?? []).map(normalizeAttachment),
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
    editedAt: normalizeNullableString(input?.editedAt),
  };
}

function normalizeAttachment(input: AttachmentWire): Attachment {
  return {
    id: input.id ?? "",
    ownerUserId: input.ownerUserId ?? "",
    scope: input.scope ?? "ATTACHMENT_SCOPE_UNSPECIFIED",
    directChatId: normalizeNullableString(input.directChatId),
    groupId: normalizeNullableString(input.groupId),
    messageId: normalizeNullableString(input.messageId),
    fileName: input.fileName ?? "",
    mimeType: input.mimeType ?? "",
    sizeBytes: normalizeCount(input.sizeBytes),
    status: input.status ?? "ATTACHMENT_STATUS_UNSPECIFIED",
    createdAt: input.createdAt ?? "",
    updatedAt: input.updatedAt ?? "",
    uploadedAt: normalizeNullableString(input.uploadedAt),
    attachedAt: normalizeNullableString(input.attachedAt),
    failedAt: normalizeNullableString(input.failedAt),
    deletedAt: normalizeNullableString(input.deletedAt),
  };
}

function normalizeGroupTypingIndicator(
  input: GroupTypingIndicatorWire | undefined,
): GroupTypingIndicator | null {
  if (!input) {
    return null;
  }

  const user = input.user;
  if (!user || typeof user.id !== "string" || user.id === "") {
    return null;
  }

  return {
    user: {
      id: user.id,
      login: normalizeLogin(user.login),
      nickname: user.nickname ?? "",
      avatarUrl: normalizeNullableString(user.avatarUrl),
    },
    updatedAt: input.updatedAt ?? "",
    expiresAt: input.expiresAt ?? "",
  };
}

function normalizeGroupTypingState(
  input: GroupTypingStateWire | undefined,
): GroupTypingState | null {
  if (!input) {
    return null;
  }

  const threadId = input.threadId ?? "";
  if (threadId === "") {
    return null;
  }

  return {
    threadId,
    typers: (input.typers ?? [])
      .map(normalizeGroupTypingIndicator)
      .filter((indicator): indicator is GroupTypingIndicator => indicator !== null),
  };
}

function normalizeGroupReadPosition(
  input: GroupReadPositionWire | undefined,
): GroupReadPosition | null {
  if (!input) {
    return null;
  }

  const messageId = input.messageId ?? "";
  const messageCreatedAt = input.messageCreatedAt ?? "";
  const updatedAt = input.updatedAt ?? "";
  if (messageId === "" && messageCreatedAt === "" && updatedAt === "") {
    return null;
  }

  return {
    messageId,
    messageCreatedAt,
    updatedAt,
  };
}

function normalizeGroupReadState(
  input: GroupReadStateWire | undefined,
): GroupReadState | null {
  if (!input) {
    return null;
  }

  const selfPosition = normalizeGroupReadPosition(input.selfPosition);
  if (!selfPosition) {
    return null;
  }

  return {
    selfPosition,
  };
}

function normalizeUnreadCount(input: UnreadStateWire | undefined): number {
  const rawValue = input?.unreadCount;
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return rawValue;
  }
  if (typeof rawValue === "string" && rawValue.trim() !== "") {
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function normalizeTextMessageContent(
  input: TextMessageContentWire | undefined,
): TextMessageContent | null {
  if (!input) {
    return null;
  }

  return {
    text: input.text ?? "",
    markdownPolicy: input.markdownPolicy ?? "MARKDOWN_POLICY_SAFE_SUBSET_V1",
  };
}

function normalizeMembershipReason(
  value: string | undefined,
): GroupMembershipReason | null {
  switch (value) {
    case "member_joined":
    case "member_removed":
    case "member_left":
      return value;
    default:
      return null;
  }
}

function normalizeGroupMemberRole(value: string | undefined): GroupMemberRole {
  switch ((value ?? "").trim().toUpperCase()) {
    case "GROUP_MEMBER_ROLE_OWNER":
    case "OWNER":
      return "owner";
    case "GROUP_MEMBER_ROLE_ADMIN":
    case "ADMIN":
      return "admin";
    case "GROUP_MEMBER_ROLE_READER":
    case "READER":
      return "reader";
    default:
      return "member";
  }
}

function normalizeNullableString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value === "" ? null : value;
}

function normalizeLogin(value: string | undefined): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase();
}

function normalizeCount(value: number | string | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}
