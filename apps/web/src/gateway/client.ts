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
  ChatUser,
  Friend,
  FriendRequest,
  GatewayClient,
  GatewayErrorCode,
  MessageTombstone,
  Profile,
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

interface MarkDirectChatReadResponseWire {
  readState?: DirectChatReadStateWire;
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
        {
          nickname: input.nickname.trim(),
          avatarUrl: input.avatarUrl,
          bio: input.bio,
          timezone: input.timezone,
          profileAccent: input.profileAccent,
          statusText: input.statusText,
          birthday: input.birthday,
          country: input.country,
          city: input.city,
        },
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
