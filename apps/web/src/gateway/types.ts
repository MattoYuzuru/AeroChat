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

export interface RTCActiveCallConflictMetadata {
  reason: "active_participation_exists";
  callId: string;
  participantId: string | null;
  scopeKind: "direct" | "group" | null;
  directChatId: string | null;
  groupId: string | null;
}

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
  pushNotificationsEnabled?: boolean;
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

export type CryptoDeviceStatus = "pending_link" | "active" | "revoked";

export type CryptoDeviceLinkIntentStatus =
  | "pending"
  | "approved"
  | "expired";

export interface CryptoDevice {
  id: string;
  userId: string;
  label: string;
  status: CryptoDeviceStatus;
  linkedByCryptoDeviceId: string | null;
  lastBundleVersion: number | null;
  lastBundlePublishedAt: string | null;
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  revokedByActor: string | null;
}

export interface CryptoDeviceBundlePayload {
  cryptoSuite: string;
  identityPublicKeyBase64: string;
  signedPrekeyPublicBase64: string;
  signedPrekeyId: string;
  signedPrekeySignatureBase64: string;
  kemPublicKeyBase64: string | null;
  kemKeyId: string | null;
  kemSignatureBase64: string | null;
  oneTimePrekeysTotal: number;
  oneTimePrekeysAvailable: number;
  bundleDigestBase64: string;
  expiresAt: string | null;
}

export interface CryptoDeviceBundle {
  cryptoDeviceId: string;
  bundleVersion: number;
  cryptoSuite: string;
  identityPublicKeyBase64: string;
  signedPrekeyPublicBase64: string;
  signedPrekeyId: string;
  signedPrekeySignatureBase64: string;
  kemPublicKeyBase64: string | null;
  kemKeyId: string | null;
  kemSignatureBase64: string | null;
  oneTimePrekeysTotal: number;
  oneTimePrekeysAvailable: number;
  bundleDigestBase64: string;
  publishedAt: string;
  expiresAt: string | null;
  supersededAt: string | null;
}

export interface CryptoDeviceBundlePublishChallenge {
  cryptoDeviceId: string;
  currentBundleVersion: number;
  currentBundleDigestBase64: string;
  publishChallengeBase64: string;
  createdAt: string;
  expiresAt: string;
}

export interface CryptoDeviceLinkIntent {
  id: string;
  userId: string;
  pendingCryptoDeviceId: string;
  status: CryptoDeviceLinkIntentStatus;
  bundleDigestBase64: string;
  approvalChallengeBase64: string;
  createdAt: string;
  expiresAt: string;
  approvedAt: string | null;
  expiredAt: string | null;
  approverCryptoDeviceId: string | null;
}

export interface CryptoDeviceLinkApprovalPayload {
  version: number;
  linkIntentId: string;
  approverCryptoDeviceId: string;
  pendingCryptoDeviceId: string;
  pendingBundleDigestBase64: string;
  approvalChallengeBase64: string;
  challengeExpiresAt: string;
  issuedAt: string;
}

export interface CryptoDeviceLinkApprovalProof {
  payload: CryptoDeviceLinkApprovalPayload;
  signatureBase64: string;
}

export interface CryptoDeviceBundlePublishProofPayload {
  version: number;
  cryptoDeviceId: string;
  previousBundleVersion: number;
  previousBundleDigestBase64: string;
  newBundleDigestBase64: string;
  publishChallengeBase64: string;
  challengeExpiresAt: string;
  issuedAt: string;
}

export interface CryptoDeviceBundlePublishProof {
  payload: CryptoDeviceBundlePublishProofPayload;
  signatureBase64: string;
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

export type GroupMemberRole = "owner" | "admin" | "member" | "reader";

export interface GroupPermissions {
  canManageInviteLinks: boolean;
  creatableInviteRoles: GroupMemberRole[];
  canManageMemberRoles: boolean;
  roleManagementTargetRoles: GroupMemberRole[];
  assignableRoles: GroupMemberRole[];
  canTransferOwnership: boolean;
  removableMemberRoles: GroupMemberRole[];
  restrictableMemberRoles: GroupMemberRole[];
  canLeaveGroup: boolean;
}

export interface Group {
  id: string;
  name: string;
  kind: string;
  selfRole: GroupMemberRole;
  memberCount: number;
  encryptedPinnedMessageIds: string[];
  unreadCount: number;
  encryptedUnreadCount: number;
  notificationsEnabled?: boolean;
  permissions: GroupPermissions;
  createdAt: string;
  updatedAt: string;
}

export interface GroupChatThread {
  id: string;
  groupId: string;
  threadKey: string;
  canSendMessages: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GroupTypingIndicator {
  user: ChatUser;
  updatedAt: string;
  expiresAt: string;
}

export interface GroupTypingState {
  threadId: string;
  typers: GroupTypingIndicator[];
}

export interface GroupMember {
  user: ChatUser;
  role: GroupMemberRole;
  joinedAt: string;
  isWriteRestricted: boolean;
  writeRestrictedAt: string | null;
}

export interface GroupInviteLink {
  id: string;
  groupId: string;
  role: GroupMemberRole;
  createdByUserId: string;
  joinCount: number;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
  lastJoinedAt: string | null;
}

export interface CreatedGroupInviteLink {
  inviteLink: GroupInviteLink;
  inviteToken: string;
}

export interface GroupInvitePreview {
  groupId: string;
  groupName: string;
  inviteRole: GroupMemberRole;
  memberCount: number;
  alreadyJoined: boolean;
}

export interface DirectChat {
  id: string;
  kind: string;
  participants: ChatUser[];
  pinnedMessageIds: string[];
  encryptedPinnedMessageIds: string[];
  unreadCount: number;
  encryptedUnreadCount: number;
  notificationsEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebPushSubscriptionInput {
  endpoint: string;
  p256dhKey: string;
  authSecret: string;
  expirationTime?: string | null;
  userAgent?: string | null;
}

export type RtcConversationScopeType = "direct" | "group";

export interface RtcConversationScope {
  kind: RtcConversationScopeType;
  directChatId: string | null;
  groupId: string | null;
}

export type RtcCallStatus = "active" | "ended";

export type RtcCallEndReason =
  | "unspecified"
  | "manual"
  | "last_participant_left";

export interface RtcCall {
  id: string;
  scope: RtcConversationScope;
  createdByUserId: string;
  status: RtcCallStatus;
  activeParticipantCount: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  endedAt: string | null;
  endedByUserId: string | null;
  endReason: RtcCallEndReason;
}

export type RtcParticipantState = "active" | "left";

export interface RtcCallParticipant {
  id: string;
  callId: string;
  userId: string;
  state: RtcParticipantState;
  joinedAt: string;
  leftAt: string | null;
  updatedAt: string;
  lastSignalAt: string | null;
}

export type RtcSignalType = "offer" | "answer" | "ice_candidate";

export interface RtcSignalEnvelope {
  callId: string;
  fromUserId: string;
  targetUserId: string;
  type: RtcSignalType;
  payload: Uint8Array;
  createdAt: string;
}

export interface RtcIceServer {
  urls: string[];
  username: string | null;
  credential: string | null;
  expiresAt: string | null;
}

export type RtcConversationScopeInput =
  | {
      kind: "direct";
      directChatId: string;
    }
  | {
      kind: "group";
      groupId: string;
    };

export interface TextMessageContent {
  text: string;
  markdownPolicy: string;
}

export interface ReplyPreview {
  messageId: string;
  author: ChatUser | null;
  hasText: boolean;
  textPreview: string;
  attachmentCount: number;
  isDeleted: boolean;
  isUnavailable: boolean;
}

export interface Attachment {
  id: string;
  ownerUserId: string;
  scope: string;
  directChatId: string | null;
  groupId: string | null;
  messageId: string | null;
  fileName: string;
  mimeType: string;
  relaySchema: string;
  sizeBytes: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  uploadedAt: string | null;
  attachedAt: string | null;
  failedAt: string | null;
  deletedAt: string | null;
}

export interface AttachmentUploadSession {
  id: string;
  attachmentId: string;
  status: string;
  uploadUrl: string;
  httpMethod: string;
  headers: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  completedAt: string | null;
  failedAt: string | null;
}

export interface AttachmentUploadIntent {
  attachment: Attachment;
  uploadSession: AttachmentUploadSession;
}

export interface AttachmentAccess {
  attachment: Attachment;
  downloadUrl: string | null;
  downloadExpiresAt: string | null;
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
  replyToMessageId?: string | null;
  replyPreview?: ReplyPreview | null;
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
}

export interface GroupMessage {
  id: string;
  groupId: string;
  threadId: string;
  senderUserId: string;
  kind: string;
  text: TextMessageContent | null;
  replyToMessageId?: string | null;
  replyPreview?: ReplyPreview | null;
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
}

export interface DirectChatReadPosition {
  messageId: string;
  messageCreatedAt: string;
  updatedAt: string;
}

export interface GroupReadPosition {
  messageId: string;
  messageCreatedAt: string;
  updatedAt: string;
}

export interface DirectChatReadState {
  selfPosition: DirectChatReadPosition | null;
  peerPosition: DirectChatReadPosition | null;
}

export interface GroupReadState {
  selfPosition: GroupReadPosition | null;
}

export interface EncryptedConversationReadPosition {
  messageId: string;
  messageCreatedAt: string;
  updatedAt: string;
}

export interface EncryptedUnreadState {
  unreadCount: number;
}

export interface EncryptedDirectChatReadState {
  selfPosition: EncryptedConversationReadPosition | null;
  peerPosition: EncryptedConversationReadPosition | null;
}

export interface EncryptedGroupReadState {
  selfPosition: EncryptedConversationReadPosition | null;
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

export interface EncryptedDirectMessageV2Delivery {
  recipientUserId?: string | null;
  recipientCryptoDeviceId: string;
  transportHeader: string;
  ciphertext: string;
  ciphertextSizeBytes: number;
  storedAt: string;
  unreadState: EncryptedUnreadState | null;
}

export interface EncryptedGroupLane {
  groupId: string;
  threadId: string;
  mlsGroupId: string;
  rosterVersion: number;
  activatedAt: string;
  updatedAt: string;
}

export interface EncryptedGroupRosterMember {
  user: ChatUser;
  role: GroupMemberRole;
  isWriteRestricted: boolean;
  hasEligibleCryptoDevices: boolean;
  eligibleCryptoDeviceIds: string[];
}

export interface EncryptedGroupRosterDevice {
  userId: string;
  cryptoDeviceId: string;
  bundleVersion: number;
  cryptoSuite: string;
  identityPublicKeyBase64: string;
  signedPrekeyPublicBase64: string;
  signedPrekeyId: string;
  signedPrekeySignatureBase64: string;
  kemPublicKeyBase64: string | null;
  kemKeyId: string | null;
  kemSignatureBase64: string | null;
  oneTimePrekeysTotal: number;
  oneTimePrekeysAvailable: number;
  bundleDigestBase64: string;
  publishedAt: string;
  expiresAt: string | null;
  updatedAt: string;
}

export interface EncryptedGroupMessageDelivery {
  recipientUserId: string;
  recipientCryptoDeviceId: string;
  storedAt: string;
  unreadState: EncryptedUnreadState | null;
}

export interface EncryptedGroupEnvelope {
  messageId: string;
  groupId: string;
  threadId: string;
  mlsGroupId: string;
  rosterVersion: number;
  senderUserId: string;
  senderCryptoDeviceId: string;
  operationKind: string;
  targetMessageId: string | null;
  revision: number;
  ciphertext: string;
  ciphertextSizeBytes: number;
  createdAt: string;
  storedAt: string;
  viewerDelivery: EncryptedGroupMessageDelivery;
}

export interface EncryptedGroupStoredEnvelope {
  messageId: string;
  groupId: string;
  threadId: string;
  mlsGroupId: string;
  rosterVersion: number;
  senderUserId: string;
  senderCryptoDeviceId: string;
  operationKind: string;
  targetMessageId: string | null;
  revision: number;
  createdAt: string;
  storedAt: string;
  storedDeliveryCount: number;
  storedDeliveries: EncryptedGroupMessageDelivery[];
}

export interface EncryptedGroupBootstrap {
  lane: EncryptedGroupLane;
  rosterMembers: EncryptedGroupRosterMember[];
  rosterDevices: EncryptedGroupRosterDevice[];
}

export interface EncryptedDirectMessageV2StoredEnvelope {
  messageId: string;
  chatId: string;
  senderUserId: string;
  senderCryptoDeviceId: string;
  operationKind: string;
  targetMessageId: string | null;
  revision: number;
  createdAt: string;
  storedAt: string;
  storedDeliveryCount: number;
  storedDeliveries: EncryptedDirectMessageV2StoredDelivery[];
}

export interface EncryptedDirectMessageV2StoredDelivery {
  recipientUserId: string;
  recipientCryptoDeviceId: string;
  storedAt: string;
  unreadState: EncryptedUnreadState | null;
}

export interface EncryptedDirectMessageV2Envelope {
  messageId: string;
  chatId: string;
  senderUserId: string;
  senderCryptoDeviceId: string;
  operationKind: string;
  targetMessageId: string | null;
  revision: number;
  createdAt: string;
  storedAt: string;
  viewerDelivery: EncryptedDirectMessageV2Delivery;
}

export interface EncryptedDirectMessageV2SendTargetDevice {
  userId: string;
  cryptoDeviceId: string;
  bundleVersion: number;
  cryptoSuite: string;
  identityPublicKeyBase64: string;
  signedPrekeyPublicBase64: string;
  signedPrekeyId: string;
  signedPrekeySignatureBase64: string;
  kemPublicKeyBase64: string | null;
  kemKeyId: string | null;
  kemSignatureBase64: string | null;
  oneTimePrekeysTotal: number;
  oneTimePrekeysAvailable: number;
  bundleDigestBase64: string;
  publishedAt: string;
  expiresAt: string | null;
}

export interface EncryptedDirectMessageV2SendBootstrap {
  chatId: string;
  recipientUserId: string;
  recipientDevices: EncryptedDirectMessageV2SendTargetDevice[];
  senderOtherDevices: EncryptedDirectMessageV2SendTargetDevice[];
}

export interface DirectChatSnapshot {
  chat: DirectChat;
  readState: DirectChatReadState | null;
  encryptedReadState: EncryptedDirectChatReadState | null;
  typingState: DirectChatTypingState | null;
  presenceState: DirectChatPresenceState | null;
}

export interface GroupChatSnapshot {
  group: Group;
  thread: GroupChatThread;
  readState: GroupReadState | null;
  encryptedReadState: EncryptedGroupReadState | null;
  typingState: GroupTypingState | null;
}

export interface DirectChatReadUpdate {
  readState: DirectChatReadState | null;
  unreadCount: number;
}

export interface GroupReadUpdate {
  readState: GroupReadState | null;
  unreadCount: number;
}

export interface EncryptedDirectChatReadUpdate {
  readState: EncryptedDirectChatReadState | null;
  unreadCount: number;
}

export interface EncryptedGroupReadUpdate {
  readState: EncryptedGroupReadState | null;
  unreadCount: number;
}

export type MessageSearchScopeKind = "direct" | "group";

export interface MessageSearchCursor {
  messageCreatedAt: string;
  messageId: string;
}

export interface MessageSearchPosition {
  messageId: string;
  messageCreatedAt: string;
}

export interface MessageSearchResult {
  scope: MessageSearchScopeKind;
  directChatId: string | null;
  groupId: string | null;
  groupThreadId: string | null;
  messageId: string;
  author: ChatUser | null;
  createdAt: string;
  editedAt: string | null;
  matchFragment: string;
  position: MessageSearchPosition | null;
}

export type MessageSearchScopeInput =
  | {
      kind: "direct";
      chatId?: string | null;
    }
  | {
      kind: "group";
      groupId?: string | null;
    };

export interface SearchMessagesInput {
  query: string;
  scope: MessageSearchScopeInput;
  pageSize?: number;
  pageCursor?: MessageSearchCursor | null;
}

export interface MessageSearchPage {
  results: MessageSearchResult[];
  nextPageCursor: MessageSearchCursor | null;
  hasMore: boolean;
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
  pushNotificationsEnabled?: boolean;
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
  getWebPushPublicKey(token: string): Promise<string>;
  upsertWebPushSubscription(
    token: string,
    input: WebPushSubscriptionInput,
  ): Promise<void>;
  deleteWebPushSubscription(token: string, endpoint: string): Promise<void>;
  registerFirstCryptoDevice(
    token: string,
    input: {
      deviceLabel?: string;
      bundle: CryptoDeviceBundlePayload;
    },
  ): Promise<{
    device: CryptoDevice;
    currentBundle: CryptoDeviceBundle;
  }>;
  registerPendingLinkedCryptoDevice(
    token: string,
    input: {
      deviceLabel?: string;
      bundle: CryptoDeviceBundlePayload;
    },
  ): Promise<{
    device: CryptoDevice;
    currentBundle: CryptoDeviceBundle;
  }>;
  listCryptoDevices(token: string): Promise<CryptoDevice[]>;
  getCryptoDevice(
    token: string,
    cryptoDeviceId: string,
  ): Promise<{
    device: CryptoDevice;
    currentBundle: CryptoDeviceBundle | null;
  }>;
  createCryptoDeviceBundlePublishChallenge(
    token: string,
    cryptoDeviceId: string,
  ): Promise<CryptoDeviceBundlePublishChallenge>;
  publishCryptoDeviceBundle(
    token: string,
    cryptoDeviceId: string,
    bundle: CryptoDeviceBundlePayload,
    proof?: CryptoDeviceBundlePublishProof,
  ): Promise<{
    device: CryptoDevice;
    currentBundle: CryptoDeviceBundle;
  }>;
  createCryptoDeviceLinkIntent(
    token: string,
    pendingCryptoDeviceId: string,
  ): Promise<CryptoDeviceLinkIntent>;
  listCryptoDeviceLinkIntents(token: string): Promise<CryptoDeviceLinkIntent[]>;
  approveCryptoDeviceLinkIntent(
    token: string,
    linkIntentId: string,
    approverCryptoDeviceId: string,
    proof: CryptoDeviceLinkApprovalProof,
  ): Promise<{
    linkIntent: CryptoDeviceLinkIntent;
    device: CryptoDevice;
  }>;
  listDevices(token: string): Promise<DeviceWithSessions[]>;
  revokeSessionOrDevice(
    token: string,
    target: RevokeSessionOrDeviceTarget,
  ): Promise<void>;
  createGroup(token: string, name: string): Promise<Group>;
  listGroups(token: string): Promise<Group[]>;
  getGroup(token: string, groupId: string): Promise<Group>;
  setGroupNotifications(
    token: string,
    groupId: string,
    notificationsEnabled: boolean,
  ): Promise<Group>;
  getGroupChat(token: string, groupId: string): Promise<GroupChatSnapshot>;
  setAllNotifications(token: string, notificationsEnabled: boolean): Promise<void>;
  markGroupChatRead(
    token: string,
    groupId: string,
    messageId: string,
  ): Promise<GroupReadUpdate>;
  markEncryptedGroupChatRead(
    token: string,
    groupId: string,
    messageId: string,
  ): Promise<EncryptedGroupReadUpdate>;
  createAttachmentUploadIntent(
    token: string,
    input:
        | {
            directChatId: string;
            groupId?: never;
            fileName: string;
            mimeType: string;
            sizeBytes: number;
            relaySchema?: string;
          }
      | {
          directChatId?: never;
          groupId: string;
          fileName: string;
          mimeType: string;
          sizeBytes: number;
          relaySchema?: string;
        },
  ): Promise<AttachmentUploadIntent>;
  completeAttachmentUpload(
    token: string,
    attachmentId: string,
    uploadSessionId: string,
  ): Promise<Attachment>;
  getAttachment(token: string, attachmentId: string): Promise<AttachmentAccess>;
  setGroupTyping(
    token: string,
    groupId: string,
    threadId: string,
  ): Promise<GroupTypingState | null>;
  clearGroupTyping(
    token: string,
    groupId: string,
    threadId: string,
  ): Promise<GroupTypingState | null>;
  listGroupMembers(token: string, groupId: string): Promise<GroupMember[]>;
  updateGroupMemberRole(
    token: string,
    groupId: string,
    userId: string,
    role: GroupMemberRole,
  ): Promise<GroupMember>;
  restrictGroupMember(token: string, groupId: string, userId: string): Promise<GroupMember>;
  unrestrictGroupMember(token: string, groupId: string, userId: string): Promise<GroupMember>;
  transferGroupOwnership(token: string, groupId: string, targetUserId: string): Promise<Group>;
  removeGroupMember(token: string, groupId: string, userId: string): Promise<void>;
  leaveGroup(token: string, groupId: string): Promise<void>;
  createGroupInviteLink(
    token: string,
    groupId: string,
    role: GroupMemberRole,
  ): Promise<CreatedGroupInviteLink>;
  listGroupInviteLinks(token: string, groupId: string): Promise<GroupInviteLink[]>;
  disableGroupInviteLink(
    token: string,
    groupId: string,
    inviteLinkId: string,
  ): Promise<GroupInviteLink>;
  previewGroupByInviteLink(token: string, inviteToken: string): Promise<GroupInvitePreview>;
  joinGroupByInviteLink(token: string, inviteToken: string): Promise<Group>;
  createDirectChat(token: string, peerUserId: string): Promise<DirectChat>;
  listDirectChats(token: string): Promise<DirectChat[]>;
  getDirectChat(token: string, chatId: string): Promise<DirectChatSnapshot>;
  setDirectChatNotifications(
    token: string,
    chatId: string,
    notificationsEnabled: boolean,
  ): Promise<DirectChat>;
  getRtcIceServers(token: string): Promise<RtcIceServer[]>;
  getActiveCall(token: string, scope: RtcConversationScopeInput): Promise<RtcCall | null>;
  startCall(
    token: string,
    scope: RtcConversationScopeInput,
  ): Promise<{
    call: RtcCall;
    selfParticipant: RtcCallParticipant | null;
  }>;
  joinCall(
    token: string,
    callId: string,
  ): Promise<{
    call: RtcCall;
    selfParticipant: RtcCallParticipant | null;
  }>;
  leaveCall(
    token: string,
    callId: string,
  ): Promise<{
    call: RtcCall;
    selfParticipant: RtcCallParticipant | null;
  }>;
  endCall(
    token: string,
    callId: string,
  ): Promise<{
    call: RtcCall;
    affectedParticipants: RtcCallParticipant[];
  }>;
  listCallParticipants(token: string, callId: string): Promise<RtcCallParticipant[]>;
  touchCallParticipant(token: string, callId: string): Promise<RtcCallParticipant>;
  sendRtcSignal(
    token: string,
    input: {
      callId: string;
      targetUserId: string;
      type: RtcSignalType;
      payload: Uint8Array;
    },
  ): Promise<RtcSignalEnvelope>;
  markDirectChatRead(
    token: string,
    chatId: string,
    messageId: string,
  ): Promise<DirectChatReadUpdate>;
  markEncryptedDirectChatRead(
    token: string,
    chatId: string,
    messageId: string,
  ): Promise<EncryptedDirectChatReadUpdate>;
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
  getEncryptedDirectMessageV2SendBootstrap(
    token: string,
    chatId: string,
    senderCryptoDeviceId: string,
  ): Promise<EncryptedDirectMessageV2SendBootstrap>;
  sendEncryptedDirectMessageV2(
    token: string,
    input: {
      chatId: string;
      messageId: string;
      messageCreatedAt: string;
      senderCryptoDeviceId: string;
      operationKind: "content" | "edit" | "tombstone";
      targetMessageId?: string | null;
      revision: number;
      attachmentIds?: string[];
      deliveries: Array<{
        recipientCryptoDeviceId: string;
        transportHeader: string;
        ciphertext: string;
      }>;
    },
  ): Promise<EncryptedDirectMessageV2StoredEnvelope>;
  sendTextMessage(
    token: string,
    chatId: string,
    text: string,
    attachmentIds?: string[],
    replyToMessageId?: string | null,
  ): Promise<DirectChatMessage>;
  editDirectChatMessage(
    token: string,
    chatId: string,
    messageId: string,
    text: string,
  ): Promise<DirectChatMessage>;
  listDirectChatMessages(
    token: string,
    chatId: string,
    pageSize?: number,
  ): Promise<DirectChatMessage[]>;
  listEncryptedDirectMessageV2(
    token: string,
    chatId: string,
    viewerCryptoDeviceId: string,
    pageSize?: number,
  ): Promise<EncryptedDirectMessageV2Envelope[]>;
  getEncryptedGroupBootstrap(
    token: string,
    groupId: string,
    viewerCryptoDeviceId: string,
  ): Promise<EncryptedGroupBootstrap>;
  sendEncryptedGroupMessage(
    token: string,
    input: {
      groupId: string;
      messageId: string;
      messageCreatedAt: string;
      mlsGroupId: string;
      rosterVersion: number;
      senderCryptoDeviceId: string;
      operationKind: "content" | "control" | "edit" | "tombstone";
      targetMessageId?: string | null;
      revision: number;
      attachmentIds?: string[];
      ciphertext: string;
    },
  ): Promise<EncryptedGroupStoredEnvelope>;
  listEncryptedGroupMessages(
    token: string,
    groupId: string,
    viewerCryptoDeviceId: string,
    pageSize?: number,
  ): Promise<EncryptedGroupEnvelope[]>;
  searchMessages(token: string, input: SearchMessagesInput): Promise<MessageSearchPage>;
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
  pinEncryptedDirectMessageV2(
    token: string,
    chatId: string,
    messageId: string,
  ): Promise<DirectChat>;
  unpinEncryptedDirectMessageV2(
    token: string,
    chatId: string,
    messageId: string,
  ): Promise<DirectChat>;
  pinEncryptedGroupMessage(
    token: string,
    groupId: string,
    messageId: string,
  ): Promise<Group>;
  unpinEncryptedGroupMessage(
    token: string,
    groupId: string,
    messageId: string,
  ): Promise<Group>;
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
  rtcActiveCallConflict: RTCActiveCallConflictMetadata | null;

  constructor(
    code: GatewayErrorCode,
    message: string,
    httpStatus: number,
    rtcActiveCallConflict: RTCActiveCallConflictMetadata | null = null,
  ) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.rtcActiveCallConflict = rtcActiveCallConflict;
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

export function isRTCActiveCallConflict(error: unknown): boolean {
  return (
    error instanceof GatewayError &&
    error.code === "failed_precondition" &&
    error.rtcActiveCallConflict?.reason === "active_participation_exists"
  );
}
