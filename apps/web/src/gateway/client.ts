import type {
  Attachment,
  AttachmentUploadSession,
  CryptoDevice,
  CryptoDeviceLinkApprovalProof,
  CryptoDeviceBundlePublishChallenge,
  CryptoDeviceBundlePublishProof,
  CryptoDeviceBundle,
  CryptoDeviceBundlePayload,
  CryptoDeviceLinkIntent,
  CurrentAuth,
  DirectChat,
  EncryptedDirectMessageV2Delivery,
  EncryptedDirectMessageV2Envelope,
  EncryptedDirectMessageV2SendBootstrap,
  EncryptedDirectMessageV2SendTargetDevice,
  EncryptedDirectMessageV2StoredEnvelope,
  EncryptedGroupBootstrap,
  EncryptedGroupEnvelope,
  EncryptedGroupLane,
  EncryptedGroupMessageDelivery,
  EncryptedGroupRosterDevice,
  EncryptedGroupRosterMember,
  EncryptedGroupStoredEnvelope,
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
  EncryptedConversationReadPosition,
  ChatUser,
  EncryptedDirectChatReadState,
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
  EncryptedUnreadState,
  EncryptedDirectMessageV2StoredDelivery,
  EncryptedGroupReadState,
  GroupReadPosition,
  GroupReadState,
  GroupTypingIndicator,
  GroupTypingState,
  MessageSearchCursor,
  MessageSearchPosition,
  MessageSearchResult,
  MessageSearchScopeInput,
  MessageTombstone,
  Profile,
  ReplyPreview,
  RevokeSessionOrDeviceTarget,
  SearchMessagesInput,
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

interface CryptoDeviceWire extends TimestampedWire {
  id?: string;
  label?: string;
  userId?: string;
  linkedByCryptoDeviceId?: string;
  lastBundleVersion?: number | string;
  lastBundlePublishedAt?: string;
  activatedAt?: string;
  revocationReason?: string;
  revokedByActor?: string;
  status?: string;
}

interface CryptoDeviceBundleWire {
  cryptoDeviceId?: string;
  bundleVersion?: number | string;
  cryptoSuite?: string;
  identityPublicKey?: string;
  signedPrekeyPublic?: string;
  signedPrekeyId?: string;
  signedPrekeySignature?: string;
  kemPublicKey?: string;
  kemKeyId?: string;
  kemSignature?: string;
  oneTimePrekeysTotal?: number | string;
  oneTimePrekeysAvailable?: number | string;
  bundleDigest?: string;
  publishedAt?: string;
  expiresAt?: string;
  supersededAt?: string;
}

interface CryptoDeviceLinkIntentWire {
  id?: string;
  userId?: string;
  pendingCryptoDeviceId?: string;
  status?: string;
  bundleDigest?: string;
  approvalChallenge?: string;
  createdAt?: string;
  expiresAt?: string;
  approvedAt?: string;
  expiredAt?: string;
  approverCryptoDeviceId?: string;
}

interface CryptoDeviceBundlePublishChallengeWire {
  cryptoDeviceId?: string;
  currentBundleVersion?: number | string;
  currentBundleDigest?: string;
  publishChallenge?: string;
  createdAt?: string;
  expiresAt?: string;
}

interface RegisterCryptoDeviceResponseWire {
  device?: CryptoDeviceWire;
  currentBundle?: CryptoDeviceBundleWire;
}

interface ListCryptoDevicesResponseWire {
  devices?: CryptoDeviceWire[];
}

interface GetCryptoDeviceResponseWire {
  device?: CryptoDeviceWire;
  currentBundle?: CryptoDeviceBundleWire;
}

interface CreateCryptoDeviceBundlePublishChallengeResponseWire {
  challenge?: CryptoDeviceBundlePublishChallengeWire;
}

interface CreateCryptoDeviceLinkIntentResponseWire {
  linkIntent?: CryptoDeviceLinkIntentWire;
}

interface ListCryptoDeviceLinkIntentsResponseWire {
  linkIntents?: CryptoDeviceLinkIntentWire[];
}

interface ApproveCryptoDeviceLinkIntentResponseWire {
  linkIntent?: CryptoDeviceLinkIntentWire;
  device?: CryptoDeviceWire;
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
  encryptedPinnedMessageIds?: string[];
  unreadState?: UnreadStateWire;
  encryptedUnreadState?: UnreadStateWire;
}

interface GroupWire extends TimestampedWire {
  id?: string;
  name?: string;
  kind?: string;
  selfRole?: string;
  memberCount?: number;
  encryptedPinnedMessageIds?: string[];
  unreadState?: UnreadStateWire;
  encryptedUnreadState?: UnreadStateWire;
  permissions?: GroupPermissionsWire;
}

interface GroupPermissionsWire {
  canManageInviteLinks?: boolean;
  creatableInviteRoles?: string[];
  canManageMemberRoles?: boolean;
  roleManagementTargetRoles?: string[];
  assignableRoles?: string[];
  canTransferOwnership?: boolean;
  removableMemberRoles?: string[];
  restrictableMemberRoles?: string[];
  canLeaveGroup?: boolean;
}

interface UnreadStateWire {
  unreadCount?: number | string;
}

interface GroupChatThreadWire extends TimestampedWire {
  id?: string;
  groupId?: string;
  threadKey?: string;
  canSendMessages?: boolean;
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

interface GroupMemberWire {
  user?: ChatUserWire;
  role?: string;
  joinedAt?: string;
  isWriteRestricted?: boolean;
  writeRestrictedAt?: string;
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

interface ReplyPreviewWire {
  messageId?: string;
  author?: ChatUserWire;
  hasText?: boolean;
  textPreview?: string;
  attachmentCount?: number | string;
  isDeleted?: boolean;
  isUnavailable?: boolean;
}

interface AttachmentWire extends TimestampedWire {
  id?: string;
  ownerUserId?: string;
  scope?: string;
  directChatId?: string;
  groupId?: string;
  messageId?: string;
  fileName?: string;
  mimeType?: string;
  relaySchema?: string;
  sizeBytes?: number | string;
  status?: string;
  uploadedAt?: string;
  attachedAt?: string;
  failedAt?: string;
  deletedAt?: string;
}

interface AttachmentUploadSessionWire extends TimestampedWire {
  id?: string;
  attachmentId?: string;
  status?: string;
  uploadUrl?: string;
  httpMethod?: string;
  headers?: Record<string, string>;
  expiresAt?: string;
  completedAt?: string;
  failedAt?: string;
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
  replyToMessageId?: string;
  replyPreview?: ReplyPreviewWire;
  attachments?: AttachmentWire[];
  editedAt?: string;
}

interface GroupMessageWire extends TimestampedWire {
  id?: string;
  groupId?: string;
  threadId?: string;
  senderUserId?: string;
  kind?: string;
  text?: TextMessageContentWire;
  replyToMessageId?: string;
  replyPreview?: ReplyPreviewWire;
  attachments?: AttachmentWire[];
  editedAt?: string;
}

interface DirectChatReadPositionWire extends TimestampedWire {
  messageId?: string;
  messageCreatedAt?: string;
}

interface GroupReadPositionWire extends TimestampedWire {
  messageId?: string;
  messageCreatedAt?: string;
}

interface DirectChatReadStateWire {
  selfPosition?: DirectChatReadPositionWire;
  peerPosition?: DirectChatReadPositionWire;
}

interface EncryptedConversationReadPositionWire extends TimestampedWire {
  messageId?: string;
  messageCreatedAt?: string;
}

interface EncryptedDirectChatReadStateWire {
  selfPosition?: EncryptedConversationReadPositionWire;
  peerPosition?: EncryptedConversationReadPositionWire;
}

interface EncryptedGroupReadStateWire {
  selfPosition?: EncryptedConversationReadPositionWire;
}

interface EncryptedDirectMessageV2DeliveryWire {
  recipientUserId?: string;
  recipientCryptoDeviceId?: string;
  transportHeader?: string;
  ciphertext?: string;
  ciphertextSizeBytes?: number | string;
  storedAt?: string;
  unreadState?: UnreadStateWire;
}

interface EncryptedDirectMessageV2EnvelopeWire {
  messageId?: string;
  chatId?: string;
  senderUserId?: string;
  senderCryptoDeviceId?: string;
  operationKind?: string;
  targetMessageId?: string;
  revision?: number | string;
  createdAt?: string;
  storedAt?: string;
  viewerDelivery?: EncryptedDirectMessageV2DeliveryWire;
}

interface EncryptedDirectMessageV2StoredEnvelopeWire {
  messageId?: string;
  chatId?: string;
  senderUserId?: string;
  senderCryptoDeviceId?: string;
  operationKind?: string;
  targetMessageId?: string;
  revision?: number | string;
  createdAt?: string;
  storedAt?: string;
  storedDeliveryCount?: number | string;
  storedDeliveries?: EncryptedDirectMessageV2StoredDeliveryWire[];
}

interface EncryptedDirectMessageV2StoredDeliveryWire {
  recipientUserId?: string;
  recipientCryptoDeviceId?: string;
  storedAt?: string;
  unreadState?: UnreadStateWire;
}

interface EncryptedDirectMessageV2SendTargetDeviceWire {
  userId?: string;
  cryptoDeviceId?: string;
  bundleVersion?: number | string;
  cryptoSuite?: string;
  identityPublicKey?: string;
  signedPrekeyPublic?: string;
  signedPrekeyId?: string;
  signedPrekeySignature?: string;
  kemPublicKey?: string;
  kemKeyId?: string;
  kemSignature?: string;
  oneTimePrekeysTotal?: number | string;
  oneTimePrekeysAvailable?: number | string;
  bundleDigest?: string;
  publishedAt?: string;
  expiresAt?: string;
}

interface EncryptedGroupLaneWire {
  groupId?: string;
  threadId?: string;
  mlsGroupId?: string;
  rosterVersion?: number | string;
  activatedAt?: string;
  updatedAt?: string;
}

interface EncryptedGroupRosterMemberWire {
  user?: ChatUserWire;
  role?: string;
  isWriteRestricted?: boolean;
  hasEligibleCryptoDevices?: boolean;
  eligibleCryptoDeviceIds?: string[];
}

interface EncryptedGroupRosterDeviceWire {
  userId?: string;
  cryptoDeviceId?: string;
  bundleVersion?: number | string;
  cryptoSuite?: string;
  identityPublicKey?: string;
  signedPrekeyPublic?: string;
  signedPrekeyId?: string;
  signedPrekeySignature?: string;
  kemPublicKey?: string;
  kemKeyId?: string;
  kemSignature?: string;
  oneTimePrekeysTotal?: number | string;
  oneTimePrekeysAvailable?: number | string;
  bundleDigest?: string;
  publishedAt?: string;
  expiresAt?: string;
  updatedAt?: string;
}

interface EncryptedGroupMessageDeliveryWire {
  recipientUserId?: string;
  recipientCryptoDeviceId?: string;
  storedAt?: string;
  unreadState?: UnreadStateWire;
}

interface EncryptedGroupEnvelopeWire {
  messageId?: string;
  groupId?: string;
  threadId?: string;
  mlsGroupId?: string;
  rosterVersion?: number | string;
  senderUserId?: string;
  senderCryptoDeviceId?: string;
  operationKind?: string;
  targetMessageId?: string;
  revision?: number | string;
  ciphertext?: string;
  ciphertextSizeBytes?: number | string;
  createdAt?: string;
  storedAt?: string;
  viewerDelivery?: EncryptedGroupMessageDeliveryWire;
}

interface EncryptedGroupStoredEnvelopeWire {
  messageId?: string;
  groupId?: string;
  threadId?: string;
  mlsGroupId?: string;
  rosterVersion?: number | string;
  senderUserId?: string;
  senderCryptoDeviceId?: string;
  operationKind?: string;
  targetMessageId?: string;
  revision?: number | string;
  createdAt?: string;
  storedAt?: string;
  storedDeliveryCount?: number | string;
  storedDeliveries?: EncryptedGroupMessageDeliveryWire[];
}

interface GetEncryptedDirectMessageV2SendBootstrapResponseWire {
  chatId?: string;
  recipientUserId?: string;
  recipientDevices?: EncryptedDirectMessageV2SendTargetDeviceWire[];
  senderOtherDevices?: EncryptedDirectMessageV2SendTargetDeviceWire[];
}

interface GetEncryptedGroupBootstrapResponseWire {
  lane?: EncryptedGroupLaneWire;
  rosterMembers?: EncryptedGroupRosterMemberWire[];
  rosterDevices?: EncryptedGroupRosterDeviceWire[];
}

interface SendEncryptedGroupMessageResponseWire {
  envelope?: EncryptedGroupStoredEnvelopeWire;
}

interface GroupReadStateWire {
  selfPosition?: GroupReadPositionWire;
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
  encryptedReadState?: EncryptedDirectChatReadStateWire;
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
  readState?: GroupReadStateWire;
  encryptedReadState?: EncryptedGroupReadStateWire;
  typingState?: GroupTypingStateWire;
}

interface CreateAttachmentUploadIntentResponseWire {
  attachment?: AttachmentWire;
  uploadSession?: AttachmentUploadSessionWire;
}

interface CompleteAttachmentUploadResponseWire {
  attachment?: AttachmentWire;
}

interface GetAttachmentResponseWire {
  attachment?: AttachmentWire;
  downloadUrl?: string;
  downloadExpiresAt?: string;
}

interface SetGroupTypingResponseWire {
  typingState?: GroupTypingStateWire;
}

interface ClearGroupTypingResponseWire {
  typingState?: GroupTypingStateWire;
}

interface MarkGroupChatReadResponseWire {
  readState?: GroupReadStateWire;
  unreadState?: UnreadStateWire;
}

interface MarkEncryptedGroupChatReadResponseWire {
  readState?: EncryptedGroupReadStateWire;
  unreadState?: UnreadStateWire;
}

interface ListGroupMembersResponseWire {
  members?: GroupMemberWire[];
}

interface UpdateGroupMemberRoleResponseWire {
  member?: GroupMemberWire;
}

interface RestrictGroupMemberResponseWire {
  member?: GroupMemberWire;
}

interface UnrestrictGroupMemberResponseWire {
  member?: GroupMemberWire;
}

interface TransferGroupOwnershipResponseWire {
  group?: GroupWire;
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

interface EditGroupMessageResponseWire {
  message?: GroupMessageWire;
}

interface MarkDirectChatReadResponseWire {
  readState?: DirectChatReadStateWire;
  unreadState?: UnreadStateWire;
}

interface MarkEncryptedDirectChatReadResponseWire {
  readState?: EncryptedDirectChatReadStateWire;
  unreadState?: UnreadStateWire;
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

interface EditDirectChatMessageResponseWire {
  message?: DirectChatMessageWire;
}

interface ListDirectChatMessagesResponseWire {
  messages?: DirectChatMessageWire[];
}

interface ListEncryptedDirectMessageV2ResponseWire {
  envelopes?: EncryptedDirectMessageV2EnvelopeWire[];
}

interface ListEncryptedGroupMessagesResponseWire {
  envelopes?: EncryptedGroupEnvelopeWire[];
}

interface SendEncryptedDirectMessageV2ResponseWire {
  envelope?: EncryptedDirectMessageV2StoredEnvelopeWire;
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

interface PinEncryptedDirectMessageV2ResponseWire {
  chat?: DirectChatWire;
}

interface UnpinEncryptedDirectMessageV2ResponseWire {
  chat?: DirectChatWire;
}

interface PinEncryptedGroupMessageResponseWire {
  group?: GroupWire;
}

interface UnpinEncryptedGroupMessageResponseWire {
  group?: GroupWire;
}

interface MessageSearchCursorWire {
  messageCreatedAt?: string;
  messageId?: string;
}

interface MessageSearchPositionWire {
  messageId?: string;
  messageCreatedAt?: string;
}

interface MessageSearchResultWire extends TimestampedWire {
  scope?: string;
  directChatId?: string;
  groupId?: string;
  groupThreadId?: string;
  messageId?: string;
  author?: ChatUserWire;
  editedAt?: string;
  matchFragment?: string;
  position?: MessageSearchPositionWire;
}

interface SearchMessagesResponseWire {
  results?: MessageSearchResultWire[];
  nextPageCursor?: MessageSearchCursorWire;
  hasMore?: boolean;
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

    async registerFirstCryptoDevice(token, input) {
      const response = await unaryCall<RegisterCryptoDeviceResponseWire>(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "RegisterFirstCryptoDevice",
        {
          deviceLabel: normalizeOptionalString(input.deviceLabel ?? ""),
          bundle: normalizeCryptoDeviceBundlePayloadForWire(input.bundle),
        },
        token,
      );

      return {
        device: normalizeCryptoDevice(response.device),
        currentBundle: normalizeCryptoDeviceBundle(response.currentBundle),
      };
    },

    async registerPendingLinkedCryptoDevice(token, input) {
      const response = await unaryCall<RegisterCryptoDeviceResponseWire>(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "RegisterPendingLinkedCryptoDevice",
        {
          deviceLabel: normalizeOptionalString(input.deviceLabel ?? ""),
          bundle: normalizeCryptoDeviceBundlePayloadForWire(input.bundle),
        },
        token,
      );

      return {
        device: normalizeCryptoDevice(response.device),
        currentBundle: normalizeCryptoDeviceBundle(response.currentBundle),
      };
    },

    async listCryptoDevices(token) {
      const response = await unaryCall<ListCryptoDevicesResponseWire>(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "ListCryptoDevices",
        {},
        token,
      );

      return (response.devices ?? []).map(normalizeCryptoDevice);
    },

    async getCryptoDevice(token, cryptoDeviceId) {
      const response = await unaryCall<GetCryptoDeviceResponseWire>(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "GetCryptoDevice",
        {
          cryptoDeviceId: cryptoDeviceId.trim(),
        },
        token,
      );

      return {
        device: normalizeCryptoDevice(response.device),
        currentBundle: normalizeCryptoDeviceBundleOrNull(response.currentBundle),
      };
    },

    async createCryptoDeviceBundlePublishChallenge(token, cryptoDeviceId) {
      const response = await unaryCall<CreateCryptoDeviceBundlePublishChallengeResponseWire>(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "CreateCryptoDeviceBundlePublishChallenge",
        {
          cryptoDeviceId: cryptoDeviceId.trim(),
        },
        token,
      );

      return normalizeCryptoDeviceBundlePublishChallenge(response.challenge);
    },

    async publishCryptoDeviceBundle(token, cryptoDeviceId, bundle, proof) {
      const response = await unaryCall<RegisterCryptoDeviceResponseWire>(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "PublishCryptoDeviceBundle",
        {
          cryptoDeviceId: cryptoDeviceId.trim(),
          bundle: normalizeCryptoDeviceBundlePayloadForWire(bundle),
          proof: proof
            ? normalizeCryptoDeviceBundlePublishProofForWire(proof)
            : undefined,
        },
        token,
      );

      return {
        device: normalizeCryptoDevice(response.device),
        currentBundle: normalizeCryptoDeviceBundle(response.currentBundle),
      };
    },

    async createCryptoDeviceLinkIntent(token, pendingCryptoDeviceId) {
      const response = await unaryCall<CreateCryptoDeviceLinkIntentResponseWire>(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "CreateCryptoDeviceLinkIntent",
        {
          pendingCryptoDeviceId: pendingCryptoDeviceId.trim(),
        },
        token,
      );

      return normalizeCryptoDeviceLinkIntent(response.linkIntent);
    },

    async listCryptoDeviceLinkIntents(token) {
      const response = await unaryCall<ListCryptoDeviceLinkIntentsResponseWire>(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "ListCryptoDeviceLinkIntents",
        {},
        token,
      );

      return (response.linkIntents ?? []).map(normalizeCryptoDeviceLinkIntent);
    },

    async approveCryptoDeviceLinkIntent(token, linkIntentId, approverCryptoDeviceId, proof) {
      const response = await unaryCall<ApproveCryptoDeviceLinkIntentResponseWire>(
        fetchImpl,
        baseUrl,
        identityServicePath,
        "ApproveCryptoDeviceLinkIntent",
        {
          linkIntentId: linkIntentId.trim(),
          approverCryptoDeviceId: approverCryptoDeviceId.trim(),
          proof: normalizeCryptoDeviceLinkApprovalProofForWire(proof),
        },
        token,
      );

      return {
        linkIntent: normalizeCryptoDeviceLinkIntent(response.linkIntent),
        device: normalizeCryptoDevice(response.device),
      };
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

    async markGroupChatRead(token, groupId, messageId) {
      const response = await unaryCall<MarkGroupChatReadResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "MarkGroupChatRead",
        {
          groupId: groupId.trim(),
          messageId: messageId.trim(),
        },
        token,
      );

      return {
        readState: normalizeGroupReadState(response.readState),
        unreadCount: normalizeUnreadCount(response.unreadState),
      };
    },

    async markEncryptedGroupChatRead(token, groupId, messageId) {
      const response = await unaryCall<MarkEncryptedGroupChatReadResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "MarkEncryptedGroupChatRead",
        {
          groupId: groupId.trim(),
          messageId: messageId.trim(),
        },
        token,
      );

      return {
        readState: normalizeEncryptedGroupReadState(response.readState),
        unreadCount: normalizeUnreadCount(response.unreadState),
      };
    },

    async createAttachmentUploadIntent(token, input) {
      const response = await unaryCall<CreateAttachmentUploadIntentResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "CreateAttachmentUploadIntent",
        {
          ...(typeof input.directChatId === "string"
            ? { directChatId: input.directChatId.trim() }
            : { groupId: input.groupId.trim() }),
          fileName: input.fileName.trim(),
          mimeType: input.mimeType.trim(),
          relaySchema:
            typeof input.relaySchema === "string" && input.relaySchema.trim() !== ""
              ? input.relaySchema.trim()
              : undefined,
          sizeBytes: String(Math.max(0, Math.trunc(input.sizeBytes))),
        },
        token,
      );

      return {
        attachment: normalizeAttachment(response.attachment),
        uploadSession: normalizeAttachmentUploadSession(response.uploadSession),
      };
    },

    async completeAttachmentUpload(token, attachmentId, uploadSessionId) {
      const response = await unaryCall<CompleteAttachmentUploadResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "CompleteAttachmentUpload",
        {
          attachmentId: attachmentId.trim(),
          uploadSessionId: uploadSessionId.trim(),
        },
        token,
      );

      return normalizeAttachment(response.attachment);
    },

    async getAttachment(token, attachmentId) {
      const response = await unaryCall<GetAttachmentResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "GetAttachment",
        {
          attachmentId: attachmentId.trim(),
        },
        token,
      );

      return {
        attachment: normalizeAttachment(response.attachment),
        downloadUrl: normalizeNullableString(response.downloadUrl),
        downloadExpiresAt: normalizeNullableString(response.downloadExpiresAt),
      };
    },

    async setGroupTyping(token, groupId, threadId) {
      const response = await unaryCall<SetGroupTypingResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "SetGroupTyping",
        {
          groupId: groupId.trim(),
          threadId: threadId.trim(),
        },
        token,
      );

      return normalizeGroupTypingState(response.typingState);
    },

    async clearGroupTyping(token, groupId, threadId) {
      const response = await unaryCall<ClearGroupTypingResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "ClearGroupTyping",
        {
          groupId: groupId.trim(),
          threadId: threadId.trim(),
        },
        token,
      );

      return normalizeGroupTypingState(response.typingState);
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

    async updateGroupMemberRole(token, groupId, userId, role) {
      const response = await unaryCall<UpdateGroupMemberRoleResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "UpdateGroupMemberRole",
        {
          groupId: groupId.trim(),
          userId: userId.trim(),
          role: normalizeGroupMemberRoleForWire(role),
        },
        token,
      );

      return normalizeGroupMember(response.member ?? {});
    },

    async restrictGroupMember(token, groupId, userId) {
      const response = await unaryCall<RestrictGroupMemberResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "RestrictGroupMember",
        {
          groupId: groupId.trim(),
          userId: userId.trim(),
        },
        token,
      );

      return normalizeGroupMember(response.member ?? {});
    },

    async unrestrictGroupMember(token, groupId, userId) {
      const response = await unaryCall<UnrestrictGroupMemberResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "UnrestrictGroupMember",
        {
          groupId: groupId.trim(),
          userId: userId.trim(),
        },
        token,
      );

      return normalizeGroupMember(response.member ?? {});
    },

    async transferGroupOwnership(token, groupId, targetUserId) {
      const response = await unaryCall<TransferGroupOwnershipResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "TransferGroupOwnership",
        {
          groupId: groupId.trim(),
          targetUserId: targetUserId.trim(),
        },
        token,
      );

      return normalizeGroup(response.group);
    },

    async removeGroupMember(token, groupId, userId) {
      await unaryCall(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "RemoveGroupMember",
        {
          groupId: groupId.trim(),
          userId: userId.trim(),
        },
        token,
      );
    },

    async leaveGroup(token, groupId) {
      await unaryCall(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "LeaveGroup",
        {
          groupId: groupId.trim(),
        },
        token,
      );
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

    async sendGroupTextMessage(
      token,
      groupId,
      text,
      attachmentIds = [],
      replyToMessageId = null,
    ) {
      const response = await unaryCall<SendGroupTextMessageResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "SendGroupTextMessage",
        {
          groupId: groupId.trim(),
          text,
          attachmentIds: normalizeIDs(attachmentIds),
          replyToMessageId: normalizeOptionalString(replyToMessageId ?? ""),
        },
        token,
      );

      return normalizeGroupMessage(response.message);
    },

    async editGroupMessage(token, groupId, messageId, text) {
      const response = await unaryCall<EditGroupMessageResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "EditGroupMessage",
        {
          groupId: groupId.trim(),
          messageId: messageId.trim(),
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

      return {
        readState: normalizeDirectChatReadState(response.readState),
        unreadCount: normalizeUnreadCount(response.unreadState),
      };
    },

    async markEncryptedDirectChatRead(token, chatId, messageId) {
      const response = await unaryCall<MarkEncryptedDirectChatReadResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "MarkEncryptedDirectChatRead",
        {
          chatId: chatId.trim(),
          messageId: messageId.trim(),
        },
        token,
      );

      return {
        readState: normalizeEncryptedDirectChatReadState(response.readState),
        unreadCount: normalizeUnreadCount(response.unreadState),
      };
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

    async getEncryptedDirectMessageV2SendBootstrap(token, chatId, senderCryptoDeviceId) {
      const response = await unaryCall<GetEncryptedDirectMessageV2SendBootstrapResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "GetEncryptedDirectMessageV2SendBootstrap",
        {
          chatId: chatId.trim(),
          senderCryptoDeviceId: senderCryptoDeviceId.trim(),
        },
        token,
      );

      return normalizeEncryptedDirectMessageV2SendBootstrap(response);
    },

    async sendEncryptedDirectMessageV2(token, input) {
      const response = await unaryCall<SendEncryptedDirectMessageV2ResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "SendEncryptedDirectMessageV2",
        {
          chatId: input.chatId.trim(),
          messageId: input.messageId.trim(),
          senderCryptoDeviceId: input.senderCryptoDeviceId.trim(),
          operationKind: normalizeEncryptedDirectMessageV2OperationKindForWire(
            input.operationKind,
          ),
          targetMessageId: normalizeOptionalString(input.targetMessageId ?? ""),
          revision: input.revision,
          deliveries: input.deliveries.map((delivery) => ({
            recipientCryptoDeviceId: delivery.recipientCryptoDeviceId.trim(),
            transportHeader: delivery.transportHeader,
            ciphertext: delivery.ciphertext,
          })),
        },
        token,
      );

      return normalizeEncryptedDirectMessageV2StoredEnvelope(response.envelope);
    },

    async sendTextMessage(
      token,
      chatId,
      text,
      attachmentIds = [],
      replyToMessageId = null,
    ) {
      const response = await unaryCall<SendTextMessageResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "SendTextMessage",
        {
          chatId: chatId.trim(),
          text,
          attachmentIds: normalizeIDs(attachmentIds),
          replyToMessageId: normalizeOptionalString(replyToMessageId ?? ""),
        },
        token,
      );

      return normalizeDirectChatMessage(response.message);
    },

    async editDirectChatMessage(token, chatId, messageId, text) {
      const response = await unaryCall<EditDirectChatMessageResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "EditDirectChatMessage",
        {
          chatId: chatId.trim(),
          messageId: messageId.trim(),
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

    async listEncryptedDirectMessageV2(
      token,
      chatId,
      viewerCryptoDeviceId,
      pageSize = 50,
    ) {
      const response = await unaryCall<ListEncryptedDirectMessageV2ResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "ListEncryptedDirectMessageV2",
        {
          chatId: chatId.trim(),
          viewerCryptoDeviceId: viewerCryptoDeviceId.trim(),
          pageSize,
        },
        token,
      );

      return (response.envelopes ?? []).map(normalizeEncryptedDirectMessageV2Envelope);
    },

    async getEncryptedGroupBootstrap(token, groupId, viewerCryptoDeviceId) {
      const response = await unaryCall<GetEncryptedGroupBootstrapResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "GetEncryptedGroupBootstrap",
        {
          groupId: groupId.trim(),
          viewerCryptoDeviceId: viewerCryptoDeviceId.trim(),
        },
        token,
      );

      return normalizeEncryptedGroupBootstrap(response);
    },

    async sendEncryptedGroupMessage(token, input) {
      const response = await unaryCall<SendEncryptedGroupMessageResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "SendEncryptedGroupMessage",
        {
          groupId: input.groupId.trim(),
          messageId: input.messageId.trim(),
          mlsGroupId: input.mlsGroupId.trim(),
          rosterVersion: input.rosterVersion,
          senderCryptoDeviceId: input.senderCryptoDeviceId.trim(),
          operationKind: normalizeEncryptedGroupOperationKindForWire(
            input.operationKind,
          ),
          targetMessageId: normalizeOptionalString(input.targetMessageId ?? ""),
          revision: input.revision,
          ciphertext: input.ciphertext,
        },
        token,
      );

      return normalizeEncryptedGroupStoredEnvelope(response.envelope);
    },

    async listEncryptedGroupMessages(
      token,
      groupId,
      viewerCryptoDeviceId,
      pageSize = 50,
    ) {
      const response = await unaryCall<ListEncryptedGroupMessagesResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "ListEncryptedGroupMessages",
        {
          groupId: groupId.trim(),
          viewerCryptoDeviceId: viewerCryptoDeviceId.trim(),
          pageSize,
        },
        token,
      );

      return (response.envelopes ?? []).map(normalizeEncryptedGroupEnvelope);
    },

    async searchMessages(token, input) {
      const response = await unaryCall<SearchMessagesResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "SearchMessages",
        buildSearchMessagesBody(input),
        token,
      );

      return {
        results: (response.results ?? []).map(normalizeMessageSearchResult),
        nextPageCursor: normalizeMessageSearchCursor(response.nextPageCursor),
        hasMore: response.hasMore ?? false,
      };
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

    async pinEncryptedDirectMessageV2(token, chatId, messageId) {
      const response = await unaryCall<PinEncryptedDirectMessageV2ResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "PinEncryptedDirectMessageV2",
        {
          chatId: chatId.trim(),
          messageId: messageId.trim(),
        },
        token,
      );

      return normalizeDirectChat(response.chat);
    },

    async unpinEncryptedDirectMessageV2(token, chatId, messageId) {
      const response = await unaryCall<UnpinEncryptedDirectMessageV2ResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "UnpinEncryptedDirectMessageV2",
        {
          chatId: chatId.trim(),
          messageId: messageId.trim(),
        },
        token,
      );

      return normalizeDirectChat(response.chat);
    },

    async pinEncryptedGroupMessage(token, groupId, messageId) {
      const response = await unaryCall<PinEncryptedGroupMessageResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "PinEncryptedGroupMessage",
        {
          groupId: groupId.trim(),
          messageId: messageId.trim(),
        },
        token,
      );

      return normalizeGroup(response.group);
    },

    async unpinEncryptedGroupMessage(token, groupId, messageId) {
      const response = await unaryCall<UnpinEncryptedGroupMessageResponseWire>(
        fetchImpl,
        baseUrl,
        chatServicePath,
        "UnpinEncryptedGroupMessage",
        {
          groupId: groupId.trim(),
          messageId: messageId.trim(),
        },
        token,
      );

      return normalizeGroup(response.group);
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

function normalizeCryptoDevice(input: CryptoDeviceWire | undefined): CryptoDevice {
  return {
    id: input?.id ?? "",
    userId: input?.userId ?? "",
    label: input?.label ?? "",
    status: normalizeCryptoDeviceStatus(input?.status),
    linkedByCryptoDeviceId: normalizeNullableString(input?.linkedByCryptoDeviceId),
    lastBundleVersion:
      input?.lastBundleVersion === undefined
        ? null
        : normalizeCount(input.lastBundleVersion),
    lastBundlePublishedAt: normalizeNullableString(input?.lastBundlePublishedAt),
    createdAt: input?.createdAt ?? "",
    activatedAt: normalizeNullableString(input?.activatedAt),
    revokedAt: normalizeNullableString(input?.revokedAt),
    revocationReason: normalizeNullableString(input?.revocationReason),
    revokedByActor: normalizeNullableString(input?.revokedByActor),
  };
}

function normalizeCryptoDeviceStatus(
  value: string | undefined,
): CryptoDevice["status"] {
  switch (value) {
    case "CRYPTO_DEVICE_STATUS_PENDING_LINK":
    case "pending_link":
      return "pending_link";
    case "CRYPTO_DEVICE_STATUS_REVOKED":
    case "revoked":
      return "revoked";
    case "CRYPTO_DEVICE_STATUS_ACTIVE":
    case "active":
    default:
      return "active";
  }
}

function normalizeCryptoDeviceBundle(
  input: CryptoDeviceBundleWire | undefined,
): CryptoDeviceBundle {
  return {
    cryptoDeviceId: input?.cryptoDeviceId ?? "",
    bundleVersion: normalizeCount(input?.bundleVersion),
    cryptoSuite: input?.cryptoSuite ?? "",
    identityPublicKeyBase64: input?.identityPublicKey ?? "",
    signedPrekeyPublicBase64: input?.signedPrekeyPublic ?? "",
    signedPrekeyId: input?.signedPrekeyId ?? "",
    signedPrekeySignatureBase64: input?.signedPrekeySignature ?? "",
    kemPublicKeyBase64: normalizeNullableString(input?.kemPublicKey),
    kemKeyId: normalizeNullableString(input?.kemKeyId),
    kemSignatureBase64: normalizeNullableString(input?.kemSignature),
    oneTimePrekeysTotal: normalizeCount(input?.oneTimePrekeysTotal),
    oneTimePrekeysAvailable: normalizeCount(input?.oneTimePrekeysAvailable),
    bundleDigestBase64: input?.bundleDigest ?? "",
    publishedAt: input?.publishedAt ?? "",
    expiresAt: normalizeNullableString(input?.expiresAt),
    supersededAt: normalizeNullableString(input?.supersededAt),
  };
}

function normalizeCryptoDeviceBundleOrNull(
  input: CryptoDeviceBundleWire | undefined,
): CryptoDeviceBundle | null {
  if (!input || (input.cryptoDeviceId ?? "") === "") {
    return null;
  }

  return normalizeCryptoDeviceBundle(input);
}

function normalizeCryptoDeviceBundlePublishChallenge(
  input: CryptoDeviceBundlePublishChallengeWire | undefined,
): CryptoDeviceBundlePublishChallenge {
  return {
    cryptoDeviceId: input?.cryptoDeviceId ?? "",
    currentBundleVersion: normalizeCount(input?.currentBundleVersion),
    currentBundleDigestBase64: input?.currentBundleDigest ?? "",
    publishChallengeBase64: input?.publishChallenge ?? "",
    createdAt: input?.createdAt ?? "",
    expiresAt: input?.expiresAt ?? "",
  };
}

function normalizeCryptoDeviceLinkIntent(
  input: CryptoDeviceLinkIntentWire | undefined,
): CryptoDeviceLinkIntent {
  return {
    id: input?.id ?? "",
    userId: input?.userId ?? "",
    pendingCryptoDeviceId: input?.pendingCryptoDeviceId ?? "",
    status: normalizeCryptoDeviceLinkIntentStatus(input?.status),
    bundleDigestBase64: input?.bundleDigest ?? "",
    approvalChallengeBase64: input?.approvalChallenge ?? "",
    createdAt: input?.createdAt ?? "",
    expiresAt: input?.expiresAt ?? "",
    approvedAt: normalizeNullableString(input?.approvedAt),
    expiredAt: normalizeNullableString(input?.expiredAt),
    approverCryptoDeviceId: normalizeNullableString(input?.approverCryptoDeviceId),
  };
}

function normalizeCryptoDeviceBundlePublishProofForWire(
  proof: CryptoDeviceBundlePublishProof,
) {
  return {
    payload: {
      version: proof.payload.version,
      cryptoDeviceId: proof.payload.cryptoDeviceId,
      previousBundleVersion: proof.payload.previousBundleVersion,
      previousBundleDigest: proof.payload.previousBundleDigestBase64,
      newBundleDigest: proof.payload.newBundleDigestBase64,
      publishChallenge: proof.payload.publishChallengeBase64,
      challengeExpiresAt: proof.payload.challengeExpiresAt,
      issuedAt: proof.payload.issuedAt,
    },
    signature: proof.signatureBase64,
  };
}

function normalizeCryptoDeviceLinkApprovalProofForWire(
  proof: CryptoDeviceLinkApprovalProof,
) {
  return {
    payload: {
      version: proof.payload.version,
      linkIntentId: proof.payload.linkIntentId,
      approverCryptoDeviceId: proof.payload.approverCryptoDeviceId,
      pendingCryptoDeviceId: proof.payload.pendingCryptoDeviceId,
      pendingBundleDigest: proof.payload.pendingBundleDigestBase64,
      approvalChallenge: proof.payload.approvalChallengeBase64,
      challengeExpiresAt: proof.payload.challengeExpiresAt,
      issuedAt: proof.payload.issuedAt,
    },
    signature: proof.signatureBase64,
  };
}

function normalizeCryptoDeviceLinkIntentStatus(
  value: string | undefined,
): CryptoDeviceLinkIntent["status"] {
  switch (value) {
    case "CRYPTO_DEVICE_LINK_INTENT_STATUS_APPROVED":
    case "approved":
      return "approved";
    case "CRYPTO_DEVICE_LINK_INTENT_STATUS_EXPIRED":
    case "expired":
      return "expired";
    case "CRYPTO_DEVICE_LINK_INTENT_STATUS_PENDING":
    case "pending":
    default:
      return "pending";
  }
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
    encryptedPinnedMessageIds: (input?.encryptedPinnedMessageIds ?? []).filter(
      (value): value is string => typeof value === "string" && value.trim() !== "",
    ),
    unreadCount: normalizeUnreadCount(input?.unreadState),
    encryptedUnreadCount: normalizeUnreadCount(input?.encryptedUnreadState),
    permissions: normalizeGroupPermissions(input?.permissions),
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
  };
}

function normalizeGroupPermissions(input: GroupPermissionsWire | undefined) {
  return {
    canManageInviteLinks: input?.canManageInviteLinks ?? false,
    creatableInviteRoles: normalizeGroupMemberRoles(input?.creatableInviteRoles),
    canManageMemberRoles: input?.canManageMemberRoles ?? false,
    roleManagementTargetRoles: normalizeGroupMemberRoles(input?.roleManagementTargetRoles),
    assignableRoles: normalizeGroupMemberRoles(input?.assignableRoles),
    canTransferOwnership: input?.canTransferOwnership ?? false,
    removableMemberRoles: normalizeGroupMemberRoles(input?.removableMemberRoles),
    restrictableMemberRoles: normalizeGroupMemberRoles(input?.restrictableMemberRoles),
    canLeaveGroup: input?.canLeaveGroup ?? false,
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

function normalizeGroupTypingIndicator(
  input: GroupTypingIndicatorWire | undefined,
): GroupTypingIndicator | null {
  if (!input) {
    return null;
  }

  const user = normalizeChatUser(input.user);
  const updatedAt = input.updatedAt ?? "";
  const expiresAt = input.expiresAt ?? "";
  if (user.id === "" || (updatedAt === "" && expiresAt === "")) {
    return null;
  }

  return {
    user,
    updatedAt,
    expiresAt,
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

function normalizeEncryptedConversationReadPosition(
  input: EncryptedConversationReadPositionWire | undefined,
): EncryptedConversationReadPosition | null {
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

function normalizeEncryptedGroupReadState(
  input: EncryptedGroupReadStateWire | undefined,
): EncryptedGroupReadState | null {
  if (!input) {
    return null;
  }

  const selfPosition = normalizeEncryptedConversationReadPosition(input.selfPosition);
  if (!selfPosition) {
    return null;
  }

  return {
    selfPosition,
  };
}

function normalizeGroupChatSnapshot(input: GetGroupChatResponseWire): GroupChatSnapshot {
  return {
    group: normalizeGroup(input.group),
    thread: normalizeGroupChatThread(input.thread),
    readState: normalizeGroupReadState(input.readState),
    encryptedReadState: normalizeEncryptedGroupReadState(input.encryptedReadState),
    typingState: normalizeGroupTypingState(input.typingState),
  };
}

function normalizeGroupMember(input: GroupMemberWire): GroupMember {
  return {
    user: normalizeChatUser(input.user),
    role: normalizeGroupMemberRole(input.role),
    joinedAt: input.joinedAt ?? "",
    isWriteRestricted: input.isWriteRestricted ?? false,
    writeRestrictedAt: normalizeNullableString(input.writeRestrictedAt),
  };
}

function normalizeGroupMemberRoles(values: string[] | undefined): GroupMemberRole[] {
  if (!values) {
    return [];
  }

  return values.map((value) => normalizeGroupMemberRole(value));
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

function normalizeAttachment(input: AttachmentWire | undefined): Attachment {
  return {
    id: input?.id ?? "",
    ownerUserId: input?.ownerUserId ?? "",
    scope: input?.scope ?? "ATTACHMENT_SCOPE_UNSPECIFIED",
    directChatId: normalizeNullableString(input?.directChatId),
    groupId: normalizeNullableString(input?.groupId),
    messageId: normalizeNullableString(input?.messageId),
    fileName: input?.fileName ?? "",
    mimeType: input?.mimeType ?? "",
    relaySchema: input?.relaySchema ?? "ATTACHMENT_RELAY_SCHEMA_UNSPECIFIED",
    sizeBytes: normalizeCount(input?.sizeBytes),
    status: input?.status ?? "ATTACHMENT_STATUS_UNSPECIFIED",
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
    uploadedAt: normalizeNullableString(input?.uploadedAt),
    attachedAt: normalizeNullableString(input?.attachedAt),
    failedAt: normalizeNullableString(input?.failedAt),
    deletedAt: normalizeNullableString(input?.deletedAt),
  };
}

function normalizeAttachmentUploadSession(
  input: AttachmentUploadSessionWire | undefined,
): AttachmentUploadSession {
  return {
    id: input?.id ?? "",
    attachmentId: input?.attachmentId ?? "",
    status: input?.status ?? "ATTACHMENT_UPLOAD_SESSION_STATUS_UNSPECIFIED",
    uploadUrl: input?.uploadUrl ?? "",
    httpMethod: input?.httpMethod ?? "",
    headers: input?.headers ?? {},
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
    expiresAt: input?.expiresAt ?? "",
    completedAt: normalizeNullableString(input?.completedAt),
    failedAt: normalizeNullableString(input?.failedAt),
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
    replyToMessageId: normalizeNullableString(input?.replyToMessageId),
    replyPreview: normalizeReplyPreview(input?.replyPreview),
    attachments: (input?.attachments ?? []).map(normalizeAttachment),
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
    editedAt: normalizeNullableString(input?.editedAt),
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
    encryptedPinnedMessageIds: (input?.encryptedPinnedMessageIds ?? []).filter(
      (value): value is string => typeof value === "string" && value.trim() !== "",
    ),
    unreadCount: normalizeUnreadCount(input?.unreadState),
    encryptedUnreadCount: normalizeUnreadCount(input?.encryptedUnreadState),
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
  };
}

function normalizeEncryptedDirectMessageV2OperationKindForWire(
  value: "content" | "edit" | "tombstone",
): string {
  switch (value) {
    case "content":
      return "ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_CONTENT";
    case "edit":
      return "ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_EDIT";
    case "tombstone":
      return "ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_TOMBSTONE";
    default:
      return "ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_UNSPECIFIED";
  }
}

function normalizeEncryptedGroupOperationKindForWire(
  value: "content" | "control" | "edit" | "tombstone",
): string {
  switch (value) {
    case "content":
      return "ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_CONTENT";
    case "control":
      return "ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_CONTROL";
    case "edit":
      return "ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_EDIT";
    case "tombstone":
      return "ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_TOMBSTONE";
    default:
      return "ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_UNSPECIFIED";
  }
}

function buildSearchMessagesBody(input: SearchMessagesInput): Record<string, unknown> {
  return {
    query: input.query.trim(),
    ...(input.scope.kind === "direct"
      ? {
          directScope: {
            chatId: input.scope.chatId?.trim() ?? "",
          },
        }
      : {
          groupScope: {
            groupId: input.scope.groupId?.trim() ?? "",
          },
        }),
    ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
    ...(input.pageCursor
      ? {
          pageCursor: {
            messageCreatedAt: input.pageCursor.messageCreatedAt,
            messageId: input.pageCursor.messageId,
          },
        }
      : {}),
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
    replyToMessageId: normalizeNullableString(input?.replyToMessageId),
    replyPreview: normalizeReplyPreview(input?.replyPreview),
    attachments: (input?.attachments ?? []).map(normalizeAttachment),
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
    editedAt: normalizeNullableString(input?.editedAt),
  };
}

function normalizeEncryptedDirectMessageV2Delivery(
  input: EncryptedDirectMessageV2DeliveryWire | undefined,
): EncryptedDirectMessageV2Delivery {
  return {
    recipientUserId: normalizeNullableString(input?.recipientUserId),
    recipientCryptoDeviceId: input?.recipientCryptoDeviceId ?? "",
    transportHeader: input?.transportHeader ?? "",
    ciphertext: input?.ciphertext ?? "",
    ciphertextSizeBytes: normalizeCount(input?.ciphertextSizeBytes),
    storedAt: input?.storedAt ?? "",
    unreadState: normalizeEncryptedUnreadState(input?.unreadState),
  };
}

function normalizeEncryptedDirectMessageV2StoredDelivery(
  input: EncryptedDirectMessageV2StoredDeliveryWire | undefined,
): EncryptedDirectMessageV2StoredDelivery {
  return {
    recipientUserId: input?.recipientUserId ?? "",
    recipientCryptoDeviceId: input?.recipientCryptoDeviceId ?? "",
    storedAt: input?.storedAt ?? "",
    unreadState: normalizeEncryptedUnreadState(input?.unreadState),
  };
}

function normalizeEncryptedDirectMessageV2StoredEnvelope(
  input: EncryptedDirectMessageV2StoredEnvelopeWire | undefined,
): EncryptedDirectMessageV2StoredEnvelope {
  return {
    messageId: input?.messageId ?? "",
    chatId: input?.chatId ?? "",
    senderUserId: input?.senderUserId ?? "",
    senderCryptoDeviceId: input?.senderCryptoDeviceId ?? "",
    operationKind: input?.operationKind ?? "",
    targetMessageId: normalizeNullableString(input?.targetMessageId),
    revision: normalizeCount(input?.revision),
    createdAt: input?.createdAt ?? "",
    storedAt: input?.storedAt ?? "",
    storedDeliveryCount: normalizeCount(input?.storedDeliveryCount),
    storedDeliveries: (input?.storedDeliveries ?? []).map(
      normalizeEncryptedDirectMessageV2StoredDelivery,
    ),
  };
}

function normalizeEncryptedDirectMessageV2Envelope(
  input: EncryptedDirectMessageV2EnvelopeWire | undefined,
): EncryptedDirectMessageV2Envelope {
  return {
    messageId: input?.messageId ?? "",
    chatId: input?.chatId ?? "",
    senderUserId: input?.senderUserId ?? "",
    senderCryptoDeviceId: input?.senderCryptoDeviceId ?? "",
    operationKind: input?.operationKind ?? "",
    targetMessageId: normalizeNullableString(input?.targetMessageId),
    revision: normalizeCount(input?.revision),
    createdAt: input?.createdAt ?? "",
    storedAt: input?.storedAt ?? "",
    viewerDelivery: normalizeEncryptedDirectMessageV2Delivery(input?.viewerDelivery),
  };
}

function normalizeEncryptedDirectMessageV2SendTargetDevice(
  input: EncryptedDirectMessageV2SendTargetDeviceWire | undefined,
): EncryptedDirectMessageV2SendTargetDevice {
  return {
    userId: input?.userId ?? "",
    cryptoDeviceId: input?.cryptoDeviceId ?? "",
    bundleVersion: normalizeCount(input?.bundleVersion),
    cryptoSuite: input?.cryptoSuite ?? "",
    identityPublicKeyBase64: input?.identityPublicKey ?? "",
    signedPrekeyPublicBase64: input?.signedPrekeyPublic ?? "",
    signedPrekeyId: input?.signedPrekeyId ?? "",
    signedPrekeySignatureBase64: input?.signedPrekeySignature ?? "",
    kemPublicKeyBase64: normalizeNullableString(input?.kemPublicKey),
    kemKeyId: normalizeNullableString(input?.kemKeyId),
    kemSignatureBase64: normalizeNullableString(input?.kemSignature),
    oneTimePrekeysTotal: normalizeCount(input?.oneTimePrekeysTotal),
    oneTimePrekeysAvailable: normalizeCount(input?.oneTimePrekeysAvailable),
    bundleDigestBase64: input?.bundleDigest ?? "",
    publishedAt: input?.publishedAt ?? "",
    expiresAt: normalizeNullableString(input?.expiresAt),
  };
}

function normalizeEncryptedDirectMessageV2SendBootstrap(
  input: GetEncryptedDirectMessageV2SendBootstrapResponseWire | undefined,
): EncryptedDirectMessageV2SendBootstrap {
  return {
    chatId: input?.chatId ?? "",
    recipientUserId: input?.recipientUserId ?? "",
    recipientDevices: (input?.recipientDevices ?? []).map(
      normalizeEncryptedDirectMessageV2SendTargetDevice,
    ),
    senderOtherDevices: (input?.senderOtherDevices ?? []).map(
      normalizeEncryptedDirectMessageV2SendTargetDevice,
    ),
  };
}

function normalizeEncryptedGroupLane(
  input: EncryptedGroupLaneWire | undefined,
): EncryptedGroupLane {
  return {
    groupId: input?.groupId ?? "",
    threadId: input?.threadId ?? "",
    mlsGroupId: input?.mlsGroupId ?? "",
    rosterVersion: normalizeCount(input?.rosterVersion),
    activatedAt: input?.activatedAt ?? "",
    updatedAt: input?.updatedAt ?? "",
  };
}

function normalizeEncryptedGroupRosterMember(
  input: EncryptedGroupRosterMemberWire | undefined,
): EncryptedGroupRosterMember {
  return {
    user: normalizeChatUser(input?.user),
    role: normalizeGroupMemberRole(input?.role),
    isWriteRestricted: input?.isWriteRestricted ?? false,
    hasEligibleCryptoDevices: input?.hasEligibleCryptoDevices ?? false,
    eligibleCryptoDeviceIds: normalizeIDs(input?.eligibleCryptoDeviceIds ?? []),
  };
}

function normalizeEncryptedGroupRosterDevice(
  input: EncryptedGroupRosterDeviceWire | undefined,
): EncryptedGroupRosterDevice {
  return {
    userId: input?.userId ?? "",
    cryptoDeviceId: input?.cryptoDeviceId ?? "",
    bundleVersion: normalizeCount(input?.bundleVersion),
    cryptoSuite: input?.cryptoSuite ?? "",
    identityPublicKeyBase64: input?.identityPublicKey ?? "",
    signedPrekeyPublicBase64: input?.signedPrekeyPublic ?? "",
    signedPrekeyId: input?.signedPrekeyId ?? "",
    signedPrekeySignatureBase64: input?.signedPrekeySignature ?? "",
    kemPublicKeyBase64: normalizeNullableString(input?.kemPublicKey),
    kemKeyId: normalizeNullableString(input?.kemKeyId),
    kemSignatureBase64: normalizeNullableString(input?.kemSignature),
    oneTimePrekeysTotal: normalizeCount(input?.oneTimePrekeysTotal),
    oneTimePrekeysAvailable: normalizeCount(input?.oneTimePrekeysAvailable),
    bundleDigestBase64: input?.bundleDigest ?? "",
    publishedAt: input?.publishedAt ?? "",
    expiresAt: normalizeNullableString(input?.expiresAt),
    updatedAt: input?.updatedAt ?? "",
  };
}

function normalizeEncryptedGroupMessageDelivery(
  input: EncryptedGroupMessageDeliveryWire | undefined,
): EncryptedGroupMessageDelivery {
  return {
    recipientUserId: input?.recipientUserId ?? "",
    recipientCryptoDeviceId: input?.recipientCryptoDeviceId ?? "",
    storedAt: input?.storedAt ?? "",
    unreadState: normalizeEncryptedUnreadState(input?.unreadState),
  };
}

function normalizeEncryptedGroupEnvelope(
  input: EncryptedGroupEnvelopeWire | undefined,
): EncryptedGroupEnvelope {
  return {
    messageId: input?.messageId ?? "",
    groupId: input?.groupId ?? "",
    threadId: input?.threadId ?? "",
    mlsGroupId: input?.mlsGroupId ?? "",
    rosterVersion: normalizeCount(input?.rosterVersion),
    senderUserId: input?.senderUserId ?? "",
    senderCryptoDeviceId: input?.senderCryptoDeviceId ?? "",
    operationKind: input?.operationKind ?? "",
    targetMessageId: normalizeNullableString(input?.targetMessageId),
    revision: normalizeCount(input?.revision),
    ciphertext: input?.ciphertext ?? "",
    ciphertextSizeBytes: normalizeCount(input?.ciphertextSizeBytes),
    createdAt: input?.createdAt ?? "",
    storedAt: input?.storedAt ?? "",
    viewerDelivery: normalizeEncryptedGroupMessageDelivery(input?.viewerDelivery),
  };
}

function normalizeEncryptedGroupStoredEnvelope(
  input: EncryptedGroupStoredEnvelopeWire | undefined,
): EncryptedGroupStoredEnvelope {
  return {
    messageId: input?.messageId ?? "",
    groupId: input?.groupId ?? "",
    threadId: input?.threadId ?? "",
    mlsGroupId: input?.mlsGroupId ?? "",
    rosterVersion: normalizeCount(input?.rosterVersion),
    senderUserId: input?.senderUserId ?? "",
    senderCryptoDeviceId: input?.senderCryptoDeviceId ?? "",
    operationKind: input?.operationKind ?? "",
    targetMessageId: normalizeNullableString(input?.targetMessageId),
    revision: normalizeCount(input?.revision),
    createdAt: input?.createdAt ?? "",
    storedAt: input?.storedAt ?? "",
    storedDeliveryCount: normalizeCount(input?.storedDeliveryCount),
    storedDeliveries: (input?.storedDeliveries ?? []).map(
      normalizeEncryptedGroupMessageDelivery,
    ),
  };
}

function normalizeEncryptedGroupBootstrap(
  input: GetEncryptedGroupBootstrapResponseWire | undefined,
): EncryptedGroupBootstrap {
  return {
    lane: normalizeEncryptedGroupLane(input?.lane),
    rosterMembers: (input?.rosterMembers ?? []).map(normalizeEncryptedGroupRosterMember),
    rosterDevices: (input?.rosterDevices ?? []).map(normalizeEncryptedGroupRosterDevice),
  };
}

function normalizeReplyPreview(input: ReplyPreviewWire | undefined): ReplyPreview | null {
  if (!input) {
    return null;
  }

  const messageId = input.messageId ?? "";
  if (messageId === "") {
    return null;
  }

  return {
    messageId,
    author: input.author ? normalizeChatUser(input.author) : null,
    hasText: input.hasText ?? false,
    textPreview: input.textPreview ?? "",
    attachmentCount: normalizeCount(input.attachmentCount),
    isDeleted: input.isDeleted ?? false,
    isUnavailable: input.isUnavailable ?? false,
  };
}

function normalizeMessageSearchScope(
  value: string | undefined,
  directChatId: string | null,
  groupId: string | null,
): MessageSearchScopeInput["kind"] {
  switch (value) {
    case "MESSAGE_SEARCH_SCOPE_KIND_GROUP":
    case "group":
      return "group";
    case "MESSAGE_SEARCH_SCOPE_KIND_DIRECT":
    case "direct":
      return "direct";
    default:
      return groupId !== null && groupId !== "" && (directChatId === null || directChatId === "")
        ? "group"
        : "direct";
  }
}

function normalizeMessageSearchCursor(
  input: MessageSearchCursorWire | undefined,
): MessageSearchCursor | null {
  if (!input) {
    return null;
  }

  const messageCreatedAt = input.messageCreatedAt ?? "";
  const messageId = input.messageId ?? "";
  if (messageCreatedAt === "" && messageId === "") {
    return null;
  }

  return {
    messageCreatedAt,
    messageId,
  };
}

function normalizeMessageSearchPosition(
  input: MessageSearchPositionWire | undefined,
): MessageSearchPosition | null {
  if (!input) {
    return null;
  }

  const messageId = input.messageId ?? "";
  const messageCreatedAt = input.messageCreatedAt ?? "";
  if (messageId === "" && messageCreatedAt === "") {
    return null;
  }

  return {
    messageId,
    messageCreatedAt,
  };
}

function normalizeMessageSearchResult(
  input: MessageSearchResultWire | undefined,
): MessageSearchResult {
  const directChatId = normalizeNullableString(input?.directChatId);
  const groupId = normalizeNullableString(input?.groupId);

  return {
    scope: normalizeMessageSearchScope(input?.scope, directChatId, groupId),
    directChatId,
    groupId,
    groupThreadId: normalizeNullableString(input?.groupThreadId),
    messageId: input?.messageId ?? "",
    author: input?.author ? normalizeChatUser(input.author) : null,
    createdAt: input?.createdAt ?? "",
    editedAt: normalizeNullableString(input?.editedAt),
    matchFragment: input?.matchFragment ?? "",
    position: normalizeMessageSearchPosition(input?.position),
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

function normalizeEncryptedDirectChatReadState(
  input: EncryptedDirectChatReadStateWire | undefined,
): EncryptedDirectChatReadState | null {
  if (!input) {
    return null;
  }

  const selfPosition = normalizeEncryptedConversationReadPosition(input.selfPosition);
  const peerPosition = normalizeEncryptedConversationReadPosition(input.peerPosition);
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
    encryptedReadState: normalizeEncryptedDirectChatReadState(input.encryptedReadState),
    typingState: normalizeDirectChatTypingState(input.typingState),
    presenceState: normalizeDirectChatPresenceState(input.presenceState),
  };
}

function normalizeEncryptedUnreadState(
  value: UnreadStateWire | undefined,
): EncryptedUnreadState | null {
  if (!value) {
    return null;
  }

  return {
    unreadCount: normalizeUnreadCount(value),
  };
}

function normalizeNullableString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value === "" ? null : value;
}

function normalizeUnreadCount(value: UnreadStateWire | undefined): number {
  return normalizeCount(value?.unreadCount);
}

function normalizeOptionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function normalizeCryptoDeviceBundlePayloadForWire(
  input: CryptoDeviceBundlePayload,
): Record<string, unknown> {
  return {
    cryptoSuite: input.cryptoSuite.trim(),
    identityPublicKey: input.identityPublicKeyBase64,
    signedPrekeyPublic: input.signedPrekeyPublicBase64,
    signedPrekeyId: input.signedPrekeyId.trim(),
    signedPrekeySignature: input.signedPrekeySignatureBase64,
    kemPublicKey: input.kemPublicKeyBase64 ?? undefined,
    kemKeyId: normalizeOptionalString(input.kemKeyId ?? ""),
    kemSignature: input.kemSignatureBase64 ?? undefined,
    oneTimePrekeysTotal: input.oneTimePrekeysTotal,
    oneTimePrekeysAvailable: input.oneTimePrekeysAvailable,
    bundleDigest: input.bundleDigestBase64,
    expiresAt: input.expiresAt ?? undefined,
  };
}

function normalizeIDs(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value !== "");
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
