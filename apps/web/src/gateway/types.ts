export type GatewayErrorCode =
  | "aborted"
  | "already_exists"
  | "canceled"
  | "data_loss"
  | "deadline_exceeded"
  | "failed_precondition"
  | "internal"
  | "invalid_argument"
  | "not_found"
  | "out_of_range"
  | "permission_denied"
  | "resource_exhausted"
  | "unauthenticated"
  | "unavailable"
  | "unimplemented"
  | "unknown";

export interface Profile {
  id: string;
  login: string;
  nickname: string;
  avatarUrl: string | null;
  bio: string | null;
  timezone: string | null;
  profileAccent: string | null;
  statusText: string | null;
  birthday: string | null;
  country: string | null;
  city: string | null;
  readReceiptsEnabled: boolean;
  presenceEnabled: boolean;
  typingVisibilityEnabled: boolean;
  keyBackupStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  id: string;
  label: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export interface Session {
  id: string;
  deviceId: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export interface DeviceWithSessions {
  device: Device;
  sessions: Session[];
}

export interface CurrentAuth {
  profile: Profile;
  device: Device | null;
  session: Session | null;
  sessionToken: string;
}

export interface FriendRequest {
  profile: Profile;
  requestedAt: string;
}

export interface Friend {
  profile: Profile;
  friendsSince: string;
}

export interface ChatUser {
  id: string;
  login: string;
  nickname: string;
  avatarUrl: string | null;
}

export interface DirectChat {
  id: string;
  kind: string;
  participants: ChatUser[];
  pinnedMessageIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TextMessageContent {
  text: string;
  markdownPolicy: string;
}

export interface MessageTombstone {
  deletedByUserId: string;
  deletedAt: string;
}

export interface DirectChatMessage {
  id: string;
  chatId: string;
  senderUserId: string;
  kind: string;
  text: TextMessageContent | null;
  tombstone: MessageTombstone | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DirectChatReadPosition {
  messageId: string;
  messageCreatedAt: string;
  updatedAt: string;
}

export interface DirectChatReadState {
  selfPosition: DirectChatReadPosition | null;
  peerPosition: DirectChatReadPosition | null;
}

export interface DirectChatTypingIndicator {
  updatedAt: string;
  expiresAt: string;
}

export interface DirectChatTypingState {
  selfTyping: DirectChatTypingIndicator | null;
  peerTyping: DirectChatTypingIndicator | null;
}

export interface DirectChatPresenceIndicator {
  heartbeatAt: string;
  expiresAt: string;
}

export interface DirectChatPresenceState {
  selfPresence: DirectChatPresenceIndicator | null;
  peerPresence: DirectChatPresenceIndicator | null;
}

export interface DirectChatSnapshot {
  chat: DirectChat;
  readState: DirectChatReadState | null;
  typingState: DirectChatTypingState | null;
  presenceState: DirectChatPresenceState | null;
}

export interface RegisterInput {
  login: string;
  password: string;
  nickname: string;
  deviceLabel: string;
}

export interface LoginInput {
  login: string;
  password: string;
  deviceLabel: string;
}

export interface UpdateCurrentProfileInput {
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
}

export type RevokeSessionOrDeviceTarget =
  | {
      kind: "session";
      sessionId: string;
    }
  | {
      kind: "device";
      deviceId: string;
    };

export interface GatewayClient {
  register(input: RegisterInput): Promise<CurrentAuth>;
  login(input: LoginInput): Promise<CurrentAuth>;
  logoutCurrentSession(token: string): Promise<void>;
  getCurrentProfile(token: string): Promise<Profile>;
  listDevices(token: string): Promise<DeviceWithSessions[]>;
  revokeSessionOrDevice(
    token: string,
    target: RevokeSessionOrDeviceTarget,
  ): Promise<void>;
  createDirectChat(token: string, peerUserId: string): Promise<DirectChat>;
  listDirectChats(token: string): Promise<DirectChat[]>;
  getDirectChat(token: string, chatId: string): Promise<DirectChatSnapshot>;
  markDirectChatRead(
    token: string,
    chatId: string,
    messageId: string,
  ): Promise<DirectChatReadState | null>;
  setDirectChatTyping(
    token: string,
    chatId: string,
  ): Promise<DirectChatTypingState | null>;
  clearDirectChatTyping(
    token: string,
    chatId: string,
  ): Promise<DirectChatTypingState | null>;
  setDirectChatPresenceHeartbeat(
    token: string,
    chatId: string,
  ): Promise<DirectChatPresenceState | null>;
  clearDirectChatPresence(
    token: string,
    chatId: string,
  ): Promise<DirectChatPresenceState | null>;
  sendTextMessage(
    token: string,
    chatId: string,
    text: string,
  ): Promise<DirectChatMessage>;
  listDirectChatMessages(
    token: string,
    chatId: string,
    pageSize?: number,
  ): Promise<DirectChatMessage[]>;
  deleteMessageForEveryone(
    token: string,
    chatId: string,
    messageId: string,
  ): Promise<DirectChatMessage>;
  pinMessage(
    token: string,
    chatId: string,
    messageId: string,
  ): Promise<DirectChatMessage>;
  unpinMessage(
    token: string,
    chatId: string,
    messageId: string,
  ): Promise<DirectChatMessage>;
  sendFriendRequest(token: string, login: string): Promise<void>;
  acceptFriendRequest(token: string, login: string): Promise<void>;
  declineFriendRequest(token: string, login: string): Promise<void>;
  cancelOutgoingFriendRequest(token: string, login: string): Promise<void>;
  listIncomingFriendRequests(token: string): Promise<FriendRequest[]>;
  listOutgoingFriendRequests(token: string): Promise<FriendRequest[]>;
  listFriends(token: string): Promise<Friend[]>;
  removeFriend(token: string, login: string): Promise<void>;
  updateCurrentProfile(
    token: string,
    input: UpdateCurrentProfileInput,
  ): Promise<Profile>;
}

export class GatewayError extends Error {
  code: GatewayErrorCode;
  httpStatus: number;

  constructor(code: GatewayErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function isGatewayErrorCode(
  error: unknown,
  code: GatewayErrorCode,
): boolean {
  return error instanceof GatewayError && error.code === code;
}

export function describeGatewayError(
  error: unknown,
  fallbackMessage: string,
): string {
  if (!(error instanceof GatewayError)) {
    if (error instanceof Error && error.message.trim() !== "") {
      return error.message;
    }

    return fallbackMessage;
  }

  switch (error.code) {
    case "already_exists":
      return error.message || "Такое состояние уже существует.";
    case "failed_precondition":
      return error.message || "Текущее состояние не позволяет выполнить это действие.";
    case "invalid_argument":
      return error.message || "Проверьте заполнение полей и повторите попытку.";
    case "not_found":
      return error.message || "Запрошенный объект не найден.";
    case "unauthenticated":
      return "Сессия недействительна. Войдите снова.";
    case "permission_denied":
      return "Доступ к этому действию запрещён.";
    case "unavailable":
      return "Gateway сейчас недоступен. Повторите попытку позже.";
    default:
      return error.message || fallbackMessage;
  }
}
