import type {
  CurrentAuth,
  DirectChat,
  DirectChatMessage,
  DirectChatPresenceIndicator,
  DirectChatPresenceState,
  DirectChatReadPosition,
  DirectChatReadState,
  DirectChatSnapshot,
  DirectChatTypingIndicator,
  DirectChatTypingState,
  Device,
  DeviceWithSessions,
  ChatUser,
  Friend,
  FriendRequest,
  GatewayClient,
  GatewayErrorCode,
  Group,
  GroupChatSnapshot,
  GroupChatThread,
  GroupInviteLink,
  GroupMessage,
  GroupMember,
  GroupMemberRole,
  MessageTombstone,
  Profile,
  RevokeSessionOrDeviceTarget,
  Session,
  TextMessageContent,
} from "./types";
import { GatewayError } from "./types";

const identityServicePath = "aerochat.identity.v1.IdentityService";
const chatServicePath = "aerochat.chat.v1.ChatService";

interface FetchLike {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface ConnectErrorPayload {
  code?: string;
  message?: string;
}

interface TimestampedWire {
  createdAt?: string;
  lastSeenAt?: string;
  revokedAt?: string;
  updatedAt?: string;
}

interface ProfileWire extends TimestampedWire {
  id?: string;
  login?: string;
  nickname?: string;
  avatarUrl?: string;
  bio?: string;
  timezone?: string;
  profileAccent?: string;
  statusText?: string;
  birthday?: string;
  country?: string;
  city?: string;
  readReceiptsEnabled?: boolean;
  presenceEnabled?: boolean;
  typingVisibilityEnabled?: boolean;
  keyBackupStatus?: string;
}

interface DeviceWire extends TimestampedWire {
  id?: string;
  label?: string;
}

interface SessionWire extends TimestampedWire {
  id?: string;
  deviceId?: string;
}

interface CurrentAuthWire {
  profile?: ProfileWire;
  device?: DeviceWire;
  session?: SessionWire;
  sessionToken?: string;
}

interface DeviceWithSessionsWire {
  device?: DeviceWire;
  sessions?: SessionWire[];
}

interface RegisterResponseWire {
  auth?: CurrentAuthWire;
}

interface LoginResponseWire {
  auth?: CurrentAuthWire;
}

interface GetCurrentProfileResponseWire {
  profile?: ProfileWire;
}

interface UpdateCurrentProfileResponseWire {
  profile?: ProfileWire;
}

interface ListDevicesResponseWire {
  devices?: DeviceWithSessionsWire[];
}

interface FriendRequestWire {
  profile?: ProfileWire;
  requestedAt?: string;
}

interface FriendWire {
  profile?: ProfileWire;
  friendsSince?: string;
}

interface ListIncomingFriendRequestsResponseWire {
  friendRequests?: FriendRequestWire[];
}

interface ListOutgoingFriendRequestsResponseWire {
  friendRequests?: FriendRequestWire[];
}

interface ListFriendsResponseWire {
  friends?: FriendWire[];
}

interface ChatUserWire {
  id?: string;
  login?: string;
  nickname?: string;
  avatarUrl?: string;
}

interface DirectChatWire extends TimestampedWire {
  id?: string;
  kind?: string;
  participants?: ChatUserWire[];
  pinnedMessageIds?: string[];
}

interface GroupWire extends TimestampedWire {
  id?: string;
  name?: string;
  kind?: string;
  selfRole?: string;
  memberCount?: number;
}

interface GroupChatThreadWire extends TimestampedWire {
  id?: string;
  groupId?: string;
  threadKey?: string;
  canSendMessages?: boolean;
}

interface GroupMemberWire {
  user?: ChatUserWire;
  role?: string;
  joinedAt?: string;
}

interface GroupInviteLinkWire extends TimestampedWire {
  id?: string;
  groupId?: string;
  role?: string;
  createdByUserId?: string;
  joinCount?: number;
  disabledAt?: string;
  lastJoinedAt?: string;
}

interface TextMessageContentWire {
  text?: string;
  markdownPolicy?: string;
}

interface MessageTombstoneWire {
  deletedByUserId?: string;
  deletedAt?: string;
}

interface DirectChatMessageWire extends TimestampedWire {
  id?: string;
  chatId?: string;
  senderUserId?: string;
  kind?: string;
  text?: TextMessageContentWire;
  tombstone?: MessageTombstoneWire;
  pinned?: boolean;
}

interface GroupMessageWire extends TimestampedWire {
  id?: string;
  groupId?: string;
  threadId?: string;
  senderUserId?: string;
  kind?: string;
  text?: TextMessageContentWire;
}

interface DirectChatReadPositionWire extends TimestampedWire {
  messageId?: string;
  messageCreatedAt?: string;
}

interface DirectChatReadStateWire {
  selfPosition?: DirectChatReadPositionWire;
  peerPosition?: DirectChatReadPositionWire;
}

interface DirectChatTypingIndicatorWire {
  updatedAt?: string;
  expiresAt?: string;
}

interface DirectChatTypingStateWire {
  selfTyping?: DirectChatTypingIndicatorWire;
  peerTyping?: DirectChatTypingIndicatorWire;
}

interface DirectChatPresenceIndicatorWire {
  heartbeatAt?: string;
  expiresAt?: string;
}

interface DirectChatPresenceStateWire {
  selfPresence?: DirectChatPresenceIndicatorWire;
  peerPresence?: DirectChatPresenceIndicatorWire;
}

interface CreateDirectChatResponseWire {
  chat?: DirectChatWire;
}

interface ListDirectChatsResponseWire {
  chats?: DirectChatWire[];
}

interface GetDirectChatResponseWire {
  chat?: DirectChatWire;
  readState?: DirectChatReadStateWire;
  typingState?: DirectChatTypingStateWire;
  presenceState?: DirectChatPresenceStateWire;
}

interface CreateGroupResponseWire {
  group?: GroupWire;
}

interface ListGroupsResponseWire {
  groups?: GroupWire[];
}

interface GetGroupResponseWire {
  group?: GroupWire;
}

interface GetGroupChatResponseWire {
  group?: GroupWire;
  thread?: GroupChatThreadWire;
}

interface ListGroupMembersResponseWire {
  members?: GroupMemberWire[];
}

interface CreateGroupInviteLinkResponseWire {
  inviteLink?: GroupInviteLinkWire;
  inviteToken?: string;
}

interface ListGroupInviteLinksResponseWire {
  inviteLinks?: GroupInviteLinkWire[];
}

interface DisableGroupInviteLinkResponseWire {
  inviteLink?: GroupInviteLinkWire;
}

interface JoinGroupByInviteLinkResponseWire {
  group?: GroupWire;
}

interface ListGroupMessagesResponseWire {
  messages?: GroupMessageWire[];
}

interface SendGroupTextMessageResponseWire {
  message?: GroupMessageWire;
}

interface MarkDirectChatReadResponseWire {
  readState?: DirectChatReadStateWire;
}

interface SetDirectChatTypingResponseWire {
  typingState?: DirectChatTypingStateWire;
}

interface ClearDirectChatTypingResponseWire {
  typingState?: DirectChatTypingStateWire;
}

interface SetDirectChatPresenceHeartbeatResponseWire {
  presenceState?: DirectChatPresenceStateWire;
}

interface ClearDirectChatPresenceResponseWire {
  presenceState?: DirectChatPresenceStateWire;
}

interface SendTextMessageResponseWire {
  message?: DirectChatMessageWire;
}

interface ListDirectChatMessagesResponseWire {
  messages?: DirectChatMessageWire[];
}

interface DeleteMessageForEveryoneResponseWire {
  message?: DirectChatMessageWire;
}

interface PinMessageResponseWire {
  message?: DirectChatMessageWire;
}

interface UnpinMessageResponseWire {
  message?: DirectChatMessageWire;
}

export function createGatewayClient(
  fetchImpl: FetchLike,
  baseUrl = resolveGatewayBaseUrl(),
): GatewayClient {
  return {
    async register(input) {
      const response = await unaryCall<RegisterResponseWire>(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "Register",
        {
          login: input.login.trim(),
          password: input.password,
          nickname: input.nickname.trim(),
          deviceLabel: normalizeOptionalString(input.deviceLabel),
        },
      );

      return normalizeCurrentAuth(response.auth);
    },

    async login(input) {
      const response = await unaryCall<LoginResponseWire>(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "Login",
        {
          login: input.login.trim(),
          password: input.password,
          deviceLabel: normalizeOptionalString(input.deviceLabel),
        },
      );

      return normalizeCurrentAuth(response.auth);
    },

    async logoutCurrentSession(token) {
      await unaryCall(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "LogoutCurrentSession",
        {},
        token,
      );
    },

    async getCurrentProfile(token) {
      const response = await unaryCall<GetCurrentProfileResponseWire>(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "GetCurrentProfile",
        {},
        token,
      );

      return normalizeProfile(response.profile);
    },

    async listDevices(token) {
      const response = await unaryCall<ListDevicesResponseWire>(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "ListDevices",
        {},
        token,
      );

      return (response.devices ?? []).map(normalizeDeviceWithSessions);
    },

    async revokeSessionOrDevice(token, target) {
      await unaryCall(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "RevokeSessionOrDevice",
        buildRevocationPayload(target),
        token,
      );
    },

    async createGroup(token, name) {
      const response = await unaryCall<CreateGroupResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "CreateGroup",
        {
          name: name.trim(),
        },
        token,
      );

      return normalizeGroup(response.group);
    },

    async listGroups(token) {
      const response = await unaryCall<ListGroupsResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "ListGroups",
        {},
        token,
      );

      return (response.groups ?? []).map(normalizeGroup);
    },

    async getGroup(token, groupId) {
      const response = await unaryCall<GetGroupResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "GetGroup",
        {
          groupId: groupId.trim(),
        },
        token,
      );

      return normalizeGroup(response.group);
    },

    async getGroupChat(token, groupId) {
      const response = await unaryCall<GetGroupChatResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "GetGroupChat",
        {
          groupId: groupId.trim(),
        },
        token,
      );

      return normalizeGroupChatSnapshot(response);
    },

    async listGroupMembers(token, groupId) {
      const response = await unaryCall<ListGroupMembersResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "ListGroupMembers",
        {
          groupId: groupId.trim(),
        },
        token,
      );

      return (response.members ?? []).map(normalizeGroupMember);
    },

    async createGroupInviteLink(token, groupId, role) {
      const response = await unaryCall<CreateGroupInviteLinkResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "CreateGroupInviteLink",
        {
          groupId: groupId.trim(),
          role: normalizeGroupMemberRoleForWire(role),
        },
        token,
      );

      return {
        inviteLink: normalizeGroupInviteLink(response.inviteLink),
        inviteToken: response.inviteToken ?? "",
      };
    },

    async listGroupInviteLinks(token, groupId) {
      const response = await unaryCall<ListGroupInviteLinksResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "ListGroupInviteLinks",
        {
          groupId: groupId.trim(),
        },
        token,
      );

      return (response.inviteLinks ?? []).map(normalizeGroupInviteLink);
    },

    async disableGroupInviteLink(token, groupId, inviteLinkId) {
      const response = await unaryCall<DisableGroupInviteLinkResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "DisableGroupInviteLink",
        {
          groupId: groupId.trim(),
          inviteLinkId: inviteLinkId.trim(),
        },
        token,
      );

      return normalizeGroupInviteLink(response.inviteLink);
    },

    async joinGroupByInviteLink(token, inviteToken) {
      const response = await unaryCall<JoinGroupByInviteLinkResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "JoinGroupByInviteLink",
        {
          inviteToken: inviteToken.trim(),
        },
        token,
      );

      return normalizeGroup(response.group);
    },

    async listGroupMessages(token, groupId, pageSize) {
      const response = await unaryCall<ListGroupMessagesResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "ListGroupMessages",
        {
          groupId: groupId.trim(),
          pageSize,
        },
        token,
      );

      return (response.messages ?? []).map(normalizeGroupMessage);
    },

    async sendGroupTextMessage(token, groupId, text) {
      const response = await unaryCall<SendGroupTextMessageResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "SendGroupTextMessage",
        {
          groupId: groupId.trim(),
          text,
        },
        token,
      );

      return normalizeGroupMessage(response.message);
    },

    async createDirectChat(token, peerUserId) {
      const response = await unaryCall<CreateDirectChatResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "CreateDirectChat",
        {
          peerUserId: peerUserId.trim(),
        },
        token,
      );

      return normalizeDirectChat(response.chat);
    },

    async listDirectChats(token) {
      const response = await unaryCall<ListDirectChatsResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "ListDirectChats",
        {},
        token,
      );

      return (response.chats ?? []).map(normalizeDirectChat);
    },

    async getDirectChat(token, chatId) {
      const response = await unaryCall<GetDirectChatResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "GetDirectChat",
        {
          chatId: chatId.trim(),
        },
        token,
      );

      return normalizeDirectChatSnapshot(response);
    },

    async markDirectChatRead(token, chatId, messageId) {
      const response = await unaryCall<MarkDirectChatReadResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "MarkDirectChatRead",
        {
          chatId: chatId.trim(),
          messageId: messageId.trim(),
        },
        token,
      );

      return normalizeDirectChatReadState(response.readState);
    },

    async setDirectChatTyping(token, chatId) {
      const response = await unaryCall<SetDirectChatTypingResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "SetDirectChatTyping",
        {
          chatId: chatId.trim(),
        },
        token,
      );

      return normalizeDirectChatTypingState(response.typingState);
    },

    async clearDirectChatTyping(token, chatId) {
      const response = await unaryCall<ClearDirectChatTypingResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "ClearDirectChatTyping",
        {
          chatId: chatId.trim(),
        },
        token,
      );

      return normalizeDirectChatTypingState(response.typingState);
    },

    async setDirectChatPresenceHeartbeat(token, chatId) {
      const response = await unaryCall<SetDirectChatPresenceHeartbeatResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "SetDirectChatPresenceHeartbeat",
        {
          chatId: chatId.trim(),
        },
        token,
      );

      return normalizeDirectChatPresenceState(response.presenceState);
    },

    async clearDirectChatPresence(token, chatId) {
      const response = await unaryCall<ClearDirectChatPresenceResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "ClearDirectChatPresence",
        {
          chatId: chatId.trim(),
        },
        token,
      );

      return normalizeDirectChatPresenceState(response.presenceState);
    },

    async sendTextMessage(token, chatId, text) {
      const response = await unaryCall<SendTextMessageResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "SendTextMessage",
        {
          chatId: chatId.trim(),
          text,
        },
        token,
      );

      return normalizeDirectChatMessage(response.message);
    },

    async listDirectChatMessages(token, chatId, pageSize = 50) {
      const response = await unaryCall<ListDirectChatMessagesResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "ListDirectChatMessages",
        {
          chatId: chatId.trim(),
          pageSize,
        },
        token,
      );

      return (response.messages ?? []).map(normalizeDirectChatMessage);
    },

    async deleteMessageForEveryone(token, chatId, messageId) {
      const response = await unaryCall<DeleteMessageForEveryoneResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "DeleteMessageForEveryone",
        {
          chatId: chatId.trim(),
          messageId: messageId.trim(),
        },
        token,
      );

      return normalizeDirectChatMessage(response.message);
    },

    async pinMessage(token, chatId, messageId) {
      const response = await unaryCall<PinMessageResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "PinMessage",
        {
          chatId: chatId.trim(),
          messageId: messageId.trim(),
        },
        token,
      );

      return normalizeDirectChatMessage(response.message);
    },

    async unpinMessage(token, chatId, messageId) {
      const response = await unaryCall<UnpinMessageResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "UnpinMessage",
        {
          chatId: chatId.trim(),
          messageId: messageId.trim(),
        },
        token,
      );

      return normalizeDirectChatMessage(response.message);
    },

    async sendFriendRequest(token, login) {
      await unaryCall(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "SendFriendRequest",
        {
          login: login.trim(),
        },
        token,
      );
    },

    async acceptFriendRequest(token, login) {
      await unaryCall(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "AcceptFriendRequest",
        {
          login: login.trim(),
        },
        token,
      );
    },

    async declineFriendRequest(token, login) {
      await unaryCall(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "DeclineFriendRequest",
        {
          login: login.trim(),
        },
        token,
      );
    },

    async cancelOutgoingFriendRequest(token, login) {
      await unaryCall(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "CancelOutgoingFriendRequest",
        {
          login: login.trim(),
        },
        token,
      );
    },

    async listIncomingFriendRequests(token) {
      const response = await unaryCall<ListIncomingFriendRequestsResponseWire>(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "ListIncomingFriendRequests",
        {},
        token,
      );

      return (response.friendRequests ?? []).map(normalizeFriendRequest);
    },

    async listOutgoingFriendRequests(token) {
      const response = await unaryCall<ListOutgoingFriendRequestsResponseWire>(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "ListOutgoingFriendRequests",
        {},
        token,
      );

      return (response.friendRequests ?? []).map(normalizeFriendRequest);
    },

    async listFriends(token) {
      const response = await unaryCall<ListFriendsResponseWire>(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "ListFriends",
        {},
        token,
      );

      return (response.friends ?? []).map(normalizeFriend);
    },

    async removeFriend(token, login) {
      await unaryCall(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "RemoveFriend",
        {
          login: login.trim(),
        },
        token,
      );
    },

    async updateCurrentProfile(token, input) {
      const response = await unaryCall<UpdateCurrentProfileResponseWire>(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "UpdateCurrentProfile",
        buildUpdateCurrentProfileBody(input),
        token,
      );

      return normalizeProfile(response.profile);
    },
  };
}

export function resolveGatewayBaseUrl(): string {
  const env = import.meta.env as ImportMetaEnv & {
    VITE_GATEWAY_BASE_URL?: string;
    VITE_API_BASE_URL?: string;
  };
  const value = env.VITE_GATEWAY_BASE_URL ?? env.VITE_API_BASE_URL ?? "/api";
  const trimmed = value.trim();

  if (trimmed === "") {
    return "/api";
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

async function unaryCall<TResponse>(
  fetchImpl: FetchLike,
  baseUrl: string,
  servicePath: string,
  method: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<TResponse> {
  const response = await fetchImpl(
    buildPath(baseUrl, servicePath, method),
    {
      method: "POST",
      headers: buildHeaders(token),
      body: JSON.stringify(body),
    },
  );

  const payload = await readPayload(response);

  if (!response.ok) {
    throw createGatewayError(response.status, payload);
  }

  return payload as TResponse;
}

function buildPath(baseUrl: string, service: string, method: string): string {
  return `${baseUrl}/${service}/${method}`;
}

function buildHeaders(token?: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Connect-Protocol-Version": "1",
    "Content-Type": "application/json",
  };

  if (typeof token === "string" && token.trim() !== "") {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      code: "unknown",
      message: `Gateway вернул некорректный JSON при статусе ${response.status}.`,
    } satisfies ConnectErrorPayload;
  }
}

function createGatewayError(status: number, payload: unknown): GatewayError {
  const connectError = payload as ConnectErrorPayload | null;
  const code = normalizeErrorCode(connectError?.code);
  const message =
    typeof connectError?.message === "string" && connectError.message.trim() !== ""
      ? connectError.message
      : `Gateway request failed with HTTP ${status}.`;

  return new GatewayError(code, message, status);
}

function normalizeErrorCode(value: string | undefined): GatewayErrorCode {
  switch (value) {
    case "aborted":
    case "already_exists":
    case "canceled":
    case "data_loss":
    case "deadline_exceeded":
    case "failed_precondition":
    case "internal":
    case "invalid_argument":
    case "not_found":
    case "out_of_range":
    case "permission_denied":
    case "resource_exhausted":
    case "unauthenticated":
    case "unavailable":
    case "unimplemented":
      return value;
    default:
      return "unknown";
  }
}

function normalizeCurrentAuth(input: CurrentAuthWire | undefined): CurrentAuth {
  return {
    profile: normalizeProfile(input?.profile),
    device: input?.device ? normalizeDevice(input.device) : null,
    session: input?.session ? normalizeSession(input.session) : null,
    sessionToken: input?.sessionToken ?? "",
  };
}

function normalizeProfile(input: ProfileWire | undefined): Profile {
  return {
    id: input?.id ?? "",
    login: input?.login ?? "",
    nickname: input?.nickname ?? "",
    avatarUrl: normalizeNullableString(input?.avatarUrl),
    bio: normalizeNullableString(input?.bio),
    timezone: normalizeNullableString(input?.timezone),
    profileAccent: normalizeNullableString(input?.profileAccent),
    statusText: normalizeNullableString(input?.statusText),
    birthday: normalizeNullableString(input?.birthday),
    country: normalizeNullableString(input?.country),
    city: normalizeNullableString(input?.city),
    readReceiptsEnabled: input?.readReceiptsEnabled ?? false,
    presenceEnabled: input?.presenceEnabled ?? false,
    typingVisibilityEnabled: input?.typingVisibilityEnabled ?? false,
    keyBackupStatus: input?.keyBackupStatus ?? "KEY_BACKUP_STATUS_UNSPECIFIED",
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
  };
}

function normalizeDevice(input: DeviceWire): Device {
  return {
    id: input.id ?? "",
    label: input.label ?? "",
    createdAt: input.createdAt ?? "",
    lastSeenAt: input.lastSeenAt ?? "",
    revokedAt: normalizeNullableString(input.revokedAt),
  };
}

function normalizeSession(input: SessionWire): Session {
  return {
    id: input.id ?? "",
    deviceId: input.deviceId ?? "",
    createdAt: input.createdAt ?? "",
    lastSeenAt: input.lastSeenAt ?? "",
    revokedAt: normalizeNullableString(input.revokedAt),
  };
}

function normalizeDeviceWithSessions(
  input: DeviceWithSessionsWire,
): DeviceWithSessions {
  return {
    device: normalizeDevice(input.device ?? {}),
    sessions: (input.sessions ?? []).map(normalizeSession),
  };
}

function normalizeFriendRequest(input: FriendRequestWire): FriendRequest {
  return {
    profile: normalizeProfile(input.profile),
    requestedAt: input.requestedAt ?? "",
  };
}

function normalizeFriend(input: FriendWire): Friend {
  return {
    profile: normalizeProfile(input.profile),
    friendsSince: input.friendsSince ?? "",
  };
}

function normalizeChatUser(input: ChatUserWire | undefined): ChatUser {
  return {
    id: input?.id ?? "",
    login: input?.login ?? "",
    nickname: input?.nickname ?? "",
    avatarUrl: normalizeNullableString(input?.avatarUrl),
  };
}

function normalizeGroupMemberRole(value: string | undefined): GroupMemberRole {
  switch (value) {
    case "GROUP_MEMBER_ROLE_OWNER":
    case "owner":
      return "owner";
    case "GROUP_MEMBER_ROLE_ADMIN":
    case "admin":
      return "admin";
    case "GROUP_MEMBER_ROLE_MEMBER":
    case "member":
      return "member";
    case "GROUP_MEMBER_ROLE_READER":
    case "reader":
      return "reader";
    default:
      return "member";
  }
}

function normalizeGroupMemberRoleForWire(value: GroupMemberRole): string {
  switch (value) {
    case "owner":
      return "GROUP_MEMBER_ROLE_OWNER";
    case "admin":
      return "GROUP_MEMBER_ROLE_ADMIN";
    case "member":
      return "GROUP_MEMBER_ROLE_MEMBER";
    case "reader":
      return "GROUP_MEMBER_ROLE_READER";
  }
}

function normalizeGroup(input: GroupWire | undefined): Group {
  return {
    id: input?.id ?? "",
    name: input?.name ?? "",
    kind: input?.kind ?? "CHAT_KIND_UNSPECIFIED",
    selfRole: normalizeGroupMemberRole(input?.selfRole),
    memberCount: input?.memberCount ?? 0,
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
  };
}

function normalizeGroupChatThread(input: GroupChatThreadWire | undefined): GroupChatThread {
  return {
    id: input?.id ?? "",
    groupId: input?.groupId ?? "",
    threadKey: input?.threadKey ?? "",
    canSendMessages: input?.canSendMessages ?? false,
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
  };
}

function normalizeGroupChatSnapshot(input: GetGroupChatResponseWire): GroupChatSnapshot {
  return {
    group: normalizeGroup(input.group),
    thread: normalizeGroupChatThread(input.thread),
  };
}

function normalizeGroupMember(input: GroupMemberWire): GroupMember {
  return {
    user: normalizeChatUser(input.user),
    role: normalizeGroupMemberRole(input.role),
    joinedAt: input.joinedAt ?? "",
  };
}

function normalizeGroupInviteLink(
  input: GroupInviteLinkWire | undefined,
): GroupInviteLink {
  return {
    id: input?.id ?? "",
    groupId: input?.groupId ?? "",
    role: normalizeGroupMemberRole(input?.role),
    createdByUserId: input?.createdByUserId ?? "",
    joinCount: input?.joinCount ?? 0,
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
    disabledAt: normalizeNullableString(input?.disabledAt),
    lastJoinedAt: normalizeNullableString(input?.lastJoinedAt),
  };
}

function normalizeGroupMessage(input: GroupMessageWire | undefined): GroupMessage {
  return {
    id: input?.id ?? "",
    groupId: input?.groupId ?? "",
    threadId: input?.threadId ?? "",
    senderUserId: input?.senderUserId ?? "",
    kind: input?.kind ?? "",
    text: input?.text ? normalizeTextMessageContent(input.text) : null,
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
  };
}

function normalizeDirectChat(input: DirectChatWire | undefined): DirectChat {
  return {
    id: input?.id ?? "",
    kind: input?.kind ?? "CHAT_KIND_UNSPECIFIED",
    participants: (input?.participants ?? []).map(normalizeChatUser),
    pinnedMessageIds: (input?.pinnedMessageIds ?? []).filter(
      (value): value is string => typeof value === "string" && value.trim() !== "",
    ),
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
  };
}

function normalizeTextMessageContent(
  input: TextMessageContentWire | undefined,
): TextMessageContent | null {
  if (!input) {
    return null;
  }

  return {
    text: input.text ?? "",
    markdownPolicy: input.markdownPolicy ?? "MARKDOWN_POLICY_UNSPECIFIED",
  };
}

function normalizeMessageTombstone(
  input: MessageTombstoneWire | undefined,
): MessageTombstone | null {
  if (!input) {
    return null;
  }

  const deletedByUserId = input.deletedByUserId ?? "";
  const deletedAt = input.deletedAt ?? "";
  if (deletedByUserId === "" && deletedAt === "") {
    return null;
  }

  return {
    deletedByUserId,
    deletedAt,
  };
}

function normalizeDirectChatMessage(
  input: DirectChatMessageWire | undefined,
): DirectChatMessage {
  return {
    id: input?.id ?? "",
    chatId: input?.chatId ?? "",
    senderUserId: input?.senderUserId ?? "",
    kind: input?.kind ?? "MESSAGE_KIND_UNSPECIFIED",
    text: normalizeTextMessageContent(input?.text),
    tombstone: normalizeMessageTombstone(input?.tombstone),
    pinned: input?.pinned ?? false,
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
  };
}

function normalizeDirectChatReadPosition(
  input: DirectChatReadPositionWire | undefined,
): DirectChatReadPosition | null {
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

function normalizeDirectChatReadState(
  input: DirectChatReadStateWire | undefined,
): DirectChatReadState | null {
  if (!input) {
    return null;
  }

  const selfPosition = normalizeDirectChatReadPosition(input.selfPosition);
  const peerPosition = normalizeDirectChatReadPosition(input.peerPosition);
  if (!selfPosition && !peerPosition) {
    return null;
  }

  return {
    selfPosition,
    peerPosition,
  };
}

function normalizeDirectChatTypingIndicator(
  input: DirectChatTypingIndicatorWire | undefined,
): DirectChatTypingIndicator | null {
  if (!input) {
    return null;
  }

  const updatedAt = input.updatedAt ?? "";
  const expiresAt = input.expiresAt ?? "";
  if (updatedAt === "" && expiresAt === "") {
    return null;
  }

  return {
    updatedAt,
    expiresAt,
  };
}

function normalizeDirectChatTypingState(
  input: DirectChatTypingStateWire | undefined,
): DirectChatTypingState | null {
  if (!input) {
    return null;
  }

  const selfTyping = normalizeDirectChatTypingIndicator(input.selfTyping);
  const peerTyping = normalizeDirectChatTypingIndicator(input.peerTyping);
  if (!selfTyping && !peerTyping) {
    return null;
  }

  return {
    selfTyping,
    peerTyping,
  };
}

function normalizeDirectChatPresenceIndicator(
  input: DirectChatPresenceIndicatorWire | undefined,
): DirectChatPresenceIndicator | null {
  if (!input) {
    return null;
  }

  const heartbeatAt = input.heartbeatAt ?? "";
  const expiresAt = input.expiresAt ?? "";
  if (heartbeatAt === "" && expiresAt === "") {
    return null;
  }

  return {
    heartbeatAt,
    expiresAt,
  };
}

function normalizeDirectChatPresenceState(
  input: DirectChatPresenceStateWire | undefined,
): DirectChatPresenceState | null {
  if (!input) {
    return null;
  }

  const selfPresence = normalizeDirectChatPresenceIndicator(input.selfPresence);
  const peerPresence = normalizeDirectChatPresenceIndicator(input.peerPresence);
  if (!selfPresence && !peerPresence) {
    return null;
  }

  return {
    selfPresence,
    peerPresence,
  };
}

function normalizeDirectChatSnapshot(
  input: GetDirectChatResponseWire,
): DirectChatSnapshot {
  return {
    chat: normalizeDirectChat(input.chat),
    readState: normalizeDirectChatReadState(input.readState),
    typingState: normalizeDirectChatTypingState(input.typingState),
    presenceState: normalizeDirectChatPresenceState(input.presenceState),
  };
}

function normalizeNullableString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value === "" ? null : value;
}

function normalizeOptionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function buildRevocationPayload(
  target: RevokeSessionOrDeviceTarget,
): Record<string, string> {
  if (target.kind === "session") {
    return {
      sessionId: target.sessionId.trim(),
    };
  }

  return {
    deviceId: target.deviceId.trim(),
  };
}

function buildUpdateCurrentProfileBody(
  input: Partial<{
    nickname: string;
    avatarUrl: string;
    bio: string;
    timezone: string;
    profileAccent: string;
    statusText: string;
    birthday: string;
    country: string;
    city: string;
    readReceiptsEnabled: boolean;
    presenceEnabled: boolean;
    typingVisibilityEnabled: boolean;
  }>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (input.nickname !== undefined) {
    body.nickname = input.nickname.trim();
  }

  if (input.avatarUrl !== undefined) {
    body.avatarUrl = input.avatarUrl;
  }

  if (input.bio !== undefined) {
    body.bio = input.bio;
  }

  if (input.timezone !== undefined) {
    body.timezone = input.timezone;
  }

  if (input.profileAccent !== undefined) {
    body.profileAccent = input.profileAccent;
  }

  if (input.statusText !== undefined) {
    body.statusText = input.statusText;
  }

  if (input.birthday !== undefined) {
    body.birthday = input.birthday;
  }

  if (input.country !== undefined) {
    body.country = input.country;
  }

  if (input.city !== undefined) {
    body.city = input.city;
  }

  if (input.readReceiptsEnabled !== undefined) {
    body.readReceiptsEnabled = input.readReceiptsEnabled;
  }

  if (input.presenceEnabled !== undefined) {
    body.presenceEnabled = input.presenceEnabled;
  }

  if (input.typingVisibilityEnabled !== undefined) {
    body.typingVisibilityEnabled = input.typingVisibilityEnabled;
  }

  return body;
}
