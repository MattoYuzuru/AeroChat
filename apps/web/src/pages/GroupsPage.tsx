import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useSearchParams } from "react-router-dom";
import { MessageAttachmentList } from "../attachments/MessageAttachmentList";
import {
  canSubmitMessageComposer,
  hasRenderableMessageText,
  normalizeComposerMessageText,
} from "../attachments/message-content";
import { describeAttachmentMimeType, formatAttachmentSize } from "../attachments/metadata";
import { downloadAttachment, openAttachmentInNewTab } from "../attachments/open";
import { VideoNoteRecorderPanel } from "../attachments/VideoNoteRecorderPanel";
import { VoiceNoteRecorderPanel } from "../attachments/VoiceNoteRecorderPanel";
import { useAttachmentComposer } from "../attachments/useAttachmentComposer";
import { useVideoNoteRecorder } from "../attachments/useVideoNoteRecorder";
import { useVoiceNoteRecorder } from "../attachments/useVoiceNoteRecorder";
import { useAuth } from "../auth/useAuth";
import { SafeMessageMarkdown } from "../chats/SafeMessageMarkdown";
import { gatewayClient } from "../gateway/runtime";
import {
  describeGatewayError,
  isGatewayErrorCode,
  type CreatedGroupInviteLink,
  type Group,
  type GroupMember,
  type GroupMemberRole,
  type GroupMessage,
  type GroupTypingState,
} from "../gateway/types";
import { buildGroupInviteUrl, extractGroupInviteToken } from "../groups/invite-token";
import { parseGroupRealtimeEvent } from "../groups/realtime";
import {
  applyGroupRealtimeToGroups,
  applyGroupRealtimeToSelectedState,
  createInitialGroupsSelectedState,
  shouldClearSelectedGroupOnRealtimeEvent,
  type GroupsSelectedState,
} from "../groups/state";
import {
  describeGroupTypingLabel,
  GROUP_TYPING_IDLE_TIMEOUT_MS,
  GROUP_TYPING_REFRESH_INTERVAL_MS,
  resolveGroupTypingSessionTarget,
  type GroupTypingSessionTarget,
} from "../groups/typing";
import { subscribeRealtimeEnvelopes } from "../realtime/events";
import {
  clearSearchJumpParams,
  findJumpTarget,
  readSearchJumpIntent,
} from "../search/jump";
import styles from "./GroupsPage.module.css";

export function GroupsPage() {
  const { state: authState, expireSession } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsStatus, setGroupsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [selectedState, setSelectedState] = useState<GroupsSelectedState>(
    createInitialGroupsSelectedState(),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [joinInput, setJoinInput] = useState("");
  const [composerText, setComposerText] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageText, setEditingMessageText] = useState("");
  const [selectedReplyMessage, setSelectedReplyMessage] = useState<GroupMessage | null>(null);
  const [inviteRole, setInviteRole] = useState<GroupMemberRole>("member");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isCreatingInviteLink, setIsCreatingInviteLink] = useState(false);
  const [pendingDisableInviteId, setPendingDisableInviteId] = useState<string | null>(null);
  const [pendingRoleUserId, setPendingRoleUserId] = useState<string | null>(null);
  const [pendingRestrictionUserId, setPendingRestrictionUserId] = useState<string | null>(null);
  const [pendingRemoveUserId, setPendingRemoveUserId] = useState<string | null>(null);
  const [pendingTransferUserId, setPendingTransferUserId] = useState<string | null>(null);
  const [pendingOpenAttachmentId, setPendingOpenAttachmentId] = useState<string | null>(null);
  const [pendingEditMessageId, setPendingEditMessageId] = useState<string | null>(null);
  const [isLeavingGroup, setIsLeavingGroup] = useState(false);
  const [memberRoleDrafts, setMemberRoleDrafts] = useState<Record<string, GroupMemberRole>>({});
  const [lastCreatedInvite, setLastCreatedInvite] = useState<CreatedGroupInviteLink | null>(null);
  const [searchJumpNotice, setSearchJumpNotice] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const selectedStateRef = useRef(selectedState);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const activeTypingTargetRef = useRef<GroupTypingSessionTarget | null>(null);
  const typingLastSentAtRef = useRef(0);
  const typingRefreshTimerRef = useRef<number | null>(null);
  const typingIdleTimerRef = useRef<number | null>(null);
  const isPageVisible = usePageVisibility();

  const selectedGroupId = searchParams.get("group")?.trim() ?? "";
  const joinTokenFromRoute = searchParams.get("join")?.trim() ?? "";
  const searchJumpIntent = readSearchJumpIntent(searchParams);
  const token = authState.status === "authenticated" ? authState.token : "";
  const activeTypingTarget = resolveGroupTypingSessionTarget({
    enabled: authState.status === "authenticated",
    pageVisible: isPageVisible,
    selectedGroupId,
    snapshotGroupId: selectedState.status === "ready" ? selectedState.snapshot.group.id : null,
    threadId: selectedState.status === "ready" ? selectedState.snapshot.thread.id : null,
    canSendMessages:
      selectedState.status === "ready" ? selectedState.snapshot.thread.canSendMessages : false,
    composerText,
  });
  const attachmentComposer = useAttachmentComposer({
    enabled: authState.status === "authenticated",
    token,
    scope:
      selectedState.status === "ready"
        ? {
            kind: "group",
            id: selectedState.snapshot.group.id,
          }
        : null,
    onUnauthenticated: expireSession,
  });
  const voiceNoteRecorder = useVoiceNoteRecorder({
    enabled: authState.status === "authenticated",
  });
  const videoNoteRecorder = useVideoNoteRecorder({
    enabled: authState.status === "authenticated",
  });
  const discardVoiceNoteRecording = useEffectEvent(() => {
    voiceNoteRecorder.discardRecording();
  });
  const discardVideoNoteRecording = useEffectEvent(() => {
    videoNoteRecorder.discardRecording();
  });
  const voiceNoteStatus = voiceNoteRecorder.state.status;
  const hasPendingVoiceNote =
    voiceNoteStatus === "requesting_permission" ||
    voiceNoteStatus === "recording" ||
    voiceNoteStatus === "processing" ||
    voiceNoteStatus === "recorded";
  const videoNoteStatus = videoNoteRecorder.state.status;
  const hasPendingVideoNote =
    videoNoteStatus === "requesting_permission" ||
    videoNoteStatus === "recording" ||
    videoNoteStatus === "processing" ||
    videoNoteStatus === "recorded";
  const canSubmitGroupComposer =
    selectedState.status === "ready" &&
    canSubmitMessageComposer({
      text: composerText,
      uploadedAttachmentId: attachmentComposer.uploadedAttachmentId,
      isUploading: attachmentComposer.isUploading,
      canSendMessages: selectedState.snapshot.thread.canSendMessages,
    });
  const canPickAttachment =
    selectedState.status === "ready" &&
    !isSendingMessage &&
    !attachmentComposer.isUploading &&
    !hasPendingVoiceNote &&
    !hasPendingVideoNote &&
    selectedState.snapshot.thread.canSendMessages;
  const canRecordVoiceNote =
    selectedState.status === "ready" &&
    !isSendingMessage &&
    !attachmentComposer.isUploading &&
    attachmentComposer.state.draft === null &&
    !hasPendingVideoNote &&
    selectedState.snapshot.thread.canSendMessages;
  const canRecordVideoNote =
    selectedState.status === "ready" &&
    !isSendingMessage &&
    !attachmentComposer.isUploading &&
    attachmentComposer.state.draft === null &&
    !hasPendingVoiceNote &&
    selectedState.snapshot.thread.canSendMessages;

  useEffect(() => {
    selectedStateRef.current = selectedState;
  }, [selectedState]);

  useEffect(() => {
    setEditingMessageId(null);
    setEditingMessageText("");
    setPendingEditMessageId(null);
    setSelectedReplyMessage(null);
    setSearchJumpNotice(null);
    setHighlightedMessageId(null);
    discardVoiceNoteRecording();
    discardVideoNoteRecording();
  }, [selectedGroupId]);

  useEffect(() => {
    if (highlightedMessageId === null) {
      return;
    }

    const timeoutID = window.setTimeout(() => {
      setHighlightedMessageId(null);
    }, 4200);

    return () => {
      window.clearTimeout(timeoutID);
    };
  }, [highlightedMessageId]);

  useEffect(() => {
    if (joinTokenFromRoute !== "") {
      setJoinInput(joinTokenFromRoute);
    }
  }, [joinTokenFromRoute]);

  useEffect(() => {
    if (authState.status !== "authenticated") {
      return;
    }

    let active = true;
    setGroupsStatus("loading");
    setGroupsError(null);

    void (async () => {
      try {
        const nextGroups = await gatewayClient.listGroups(token);
        if (!active) {
          return;
        }

        setGroups(nextGroups);
        setGroupsStatus("ready");
      } catch (error) {
        const message = resolveProtectedError(
          error,
          "Не удалось загрузить список групп через gateway.",
          expireSession,
        );
        if (!active || message === null) {
          return;
        }

        setGroups([]);
        setGroupsStatus("error");
        setGroupsError(message);
      }
    })();

    return () => {
      active = false;
    };
  }, [authState.status, token, expireSession]);

  useEffect(() => {
    if (authState.status !== "authenticated") {
      return;
    }
    if (selectedGroupId === "") {
      setSelectedState(createInitialGroupsSelectedState());
      setComposerText("");
      setEditingMessageId(null);
      setEditingMessageText("");
      setPendingEditMessageId(null);
      setSelectedReplyMessage(null);
      setMemberRoleDrafts({});
      return;
    }

    let active = true;
    setSelectedState({
      status: "loading",
      snapshot: null,
      members: [],
      inviteLinks: [],
      messages: [],
      errorMessage: null,
    });

    void (async () => {
      try {
        const snapshot = await gatewayClient.getGroupChat(token, selectedGroupId);
        const membersPromise = gatewayClient.listGroupMembers(token, selectedGroupId);
        const messagesPromise = gatewayClient.listGroupMessages(token, selectedGroupId);
        const inviteLinksPromise = snapshot.group.permissions.canManageInviteLinks
          ? gatewayClient.listGroupInviteLinks(token, selectedGroupId)
          : Promise.resolve([]);
        const [members, messages, inviteLinks] = await Promise.all([
          membersPromise,
          messagesPromise,
          inviteLinksPromise,
        ]);
        if (!active) {
          return;
        }

        let readState = snapshot.readState;
        let group = snapshot.group;
        const latestMessage = messages[0] ?? null;
        if (latestMessage) {
          const readUpdate = await gatewayClient.markGroupChatRead(
            token,
            selectedGroupId,
            latestMessage.id,
          );
          if (!active) {
            return;
          }
          readState = readUpdate.readState ?? readState;
          group = {
            ...group,
            unreadCount: readUpdate.unreadCount,
          };
        }

        setSelectedState({
          status: "ready",
          snapshot: {
            ...snapshot,
            group,
            readState,
          },
          members,
          inviteLinks,
          messages,
          errorMessage: null,
        });
        setMemberRoleDrafts(buildMemberRoleDrafts(members));
      } catch (error) {
        const message = resolveProtectedError(
          error,
          "Не удалось открыть group chat через gateway.",
          expireSession,
        );
        if (!active || message === null) {
          return;
        }

        setSelectedState({
          status: "error",
          snapshot: null,
          members: [],
          inviteLinks: [],
          messages: [],
          errorMessage: message,
        });
        setMemberRoleDrafts({});
      }
    })();

    return () => {
      active = false;
    };
  }, [authState.status, expireSession, selectedGroupId, token]);

  const authenticatedUserId =
    authState.status === "authenticated" ? authState.profile.id : null;

  useEffect(() => {
    if (authState.status !== "authenticated") {
      return;
    }

    const currentUserId = authenticatedUserId;
    if (currentUserId === null) {
      return;
    }

    return subscribeRealtimeEnvelopes((envelope) => {
      const event = parseGroupRealtimeEvent(envelope);
      if (!event) {
        return;
      }

      setGroups((current) => applyGroupRealtimeToGroups(current, event, currentUserId));

      const shouldClearSelection = shouldClearSelectedGroupOnRealtimeEvent(
        selectedStateRef.current,
        event,
      );
      if (shouldClearSelection) {
        setSearchParams(new URLSearchParams(), { replace: true });
        setComposerText("");
        setNotice("Live state: доступ к группе больше не активен.");
      }

      const nextSelectedState = applyGroupRealtimeToSelectedState(
        selectedStateRef.current,
        event,
        currentUserId,
      );
      selectedStateRef.current = nextSelectedState;
      setSelectedState(nextSelectedState);

      if (event.type === "group.message.updated") {
        return;
      }

      if (nextSelectedState?.status === "ready") {
        setMemberRoleDrafts(buildMemberRoleDrafts(nextSelectedState.members));
        return;
      }

      setMemberRoleDrafts({});
    });
  }, [authState.status, authenticatedUserId, setSearchParams]);

  const latestSelectedMessage =
    selectedState.status === "ready" ? selectedState.messages[0] ?? null : null;
  const shouldAutoMarkGroupRead =
    authState.status === "authenticated" &&
    isPageVisible &&
    selectedState.status === "ready" &&
    latestSelectedMessage !== null &&
    latestSelectedMessage.senderUserId !== authState.profile.id &&
    selectedState.snapshot.readState?.selfPosition?.messageId !== latestSelectedMessage.id;

  useEffect(() => {
    if (
      !shouldAutoMarkGroupRead ||
      selectedState.status !== "ready" ||
      latestSelectedMessage === null
    ) {
      return;
    }

    let cancelled = false;
    const activeGroupId = selectedState.snapshot.group.id;

    void gatewayClient
      .markGroupChatRead(token, activeGroupId, latestSelectedMessage.id)
      .then((readUpdate) => {
        if (cancelled) {
          return;
        }

        setSelectedState((current) => {
          if (current.status !== "ready" || current.snapshot.group.id !== activeGroupId) {
            return current;
          }

          return {
            ...current,
            snapshot: {
              ...current.snapshot,
              group: {
                ...current.snapshot.group,
                unreadCount: readUpdate.unreadCount,
              },
              readState: readUpdate.readState,
            },
          };
        });
      })
      .catch((error) => {
        resolveProtectedError(
          error,
          "Не удалось обновить group read state через gateway.",
          expireSession,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [expireSession, latestSelectedMessage, selectedState, shouldAutoMarkGroupRead, token]);

  useEffect(() => {
    const clearTypingTimers = () => {
      clearGroupTypingRefreshTimer(typingRefreshTimerRef);
      clearGroupTypingIdleTimer(typingIdleTimerRef);
    };

    const previousTarget = activeTypingTargetRef.current;

    if (activeTypingTarget === null) {
      clearTypingTimers();
      typingLastSentAtRef.current = 0;
      activeTypingTargetRef.current = null;

      if (previousTarget !== null) {
        void clearGroupTypingSilently(
          token,
          previousTarget,
          setSelectedState,
          expireSession,
        );
      }

      return;
    }

    let cancelled = false;
    activeTypingTargetRef.current = activeTypingTarget;

    if (
      previousTarget !== null &&
      (previousTarget.groupId !== activeTypingTarget.groupId ||
        previousTarget.threadId !== activeTypingTarget.threadId)
    ) {
      typingLastSentAtRef.current = 0;
      void clearGroupTypingSilently(
        token,
        previousTarget,
        setSelectedState,
        expireSession,
      );
    }

    const scheduleRefresh = () => {
      if (cancelled) {
        return;
      }

      clearGroupTypingRefreshTimer(typingRefreshTimerRef);
      typingRefreshTimerRef.current = window.setTimeout(() => {
        void publishTyping(true);
      }, GROUP_TYPING_REFRESH_INTERVAL_MS);
    };

    const scheduleIdleClear = () => {
      if (cancelled) {
        return;
      }

      clearGroupTypingIdleTimer(typingIdleTimerRef);
      typingIdleTimerRef.current = window.setTimeout(() => {
        typingLastSentAtRef.current = 0;
        activeTypingTargetRef.current = null;
        clearTypingTimers();
        void clearGroupTypingSilently(
          token,
          activeTypingTarget,
          setSelectedState,
          expireSession,
        );
      }, GROUP_TYPING_IDLE_TIMEOUT_MS);
    };

    const publishTyping = async (force: boolean) => {
      if (cancelled) {
        return;
      }

      const now = Date.now();
      if (
        !force &&
        typingLastSentAtRef.current !== 0 &&
        now - typingLastSentAtRef.current < GROUP_TYPING_REFRESH_INTERVAL_MS
      ) {
        scheduleRefresh();
        return;
      }

      try {
        const typingState = await gatewayClient.setGroupTyping(
          token,
          activeTypingTarget.groupId,
          activeTypingTarget.threadId,
        );
        if (cancelled) {
          return;
        }

        typingLastSentAtRef.current = Date.now();
        replaceSelectedGroupTypingState(
          setSelectedState,
          activeTypingTarget.groupId,
          activeTypingTarget.threadId,
          typingState,
        );
      } catch (error) {
        if (handleGroupTypingAuthError(error, expireSession)) {
          clearTypingTimers();
          return;
        }
      } finally {
        if (!cancelled) {
          scheduleRefresh();
        }
      }
    };

    scheduleIdleClear();
    void publishTyping(
      previousTarget === null ||
        previousTarget.groupId !== activeTypingTarget.groupId ||
        previousTarget.threadId !== activeTypingTarget.threadId ||
        typingLastSentAtRef.current === 0,
    );

    return () => {
      cancelled = true;
      clearTypingTimers();
    };
  }, [activeTypingTarget, expireSession, token]);

  useEffect(() => {
    return () => {
      const activeTypingTarget = activeTypingTargetRef.current;
      activeTypingTargetRef.current = null;
      typingLastSentAtRef.current = 0;
      clearGroupTypingRefreshTimer(typingRefreshTimerRef);
      clearGroupTypingIdleTimer(typingIdleTimerRef);
      if (activeTypingTarget !== null) {
        void clearGroupTypingSilently(
          token,
          activeTypingTarget,
          setSelectedState,
          expireSession,
        );
      }
    };
  }, [expireSession, token]);

  useEffect(() => {
    if (searchJumpIntent === null || selectedState.status !== "ready") {
      return;
    }

    if (selectedState.snapshot.group.id !== selectedGroupId) {
      return;
    }

    const targetMessage = findJumpTarget(selectedState.messages, searchJumpIntent.messageId);
    if (targetMessage === null) {
      setSearchJumpNotice(
        "Найденное сообщение пока не попало в текущую загруженную историю группы. Переход ограничен последним загруженным окном primary thread.",
      );
      setHighlightedMessageId(null);
      setSearchParams(clearSearchJumpParams(searchParams), { replace: true });
      return;
    }

    setSearchJumpNotice(null);
    setHighlightedMessageId(targetMessage.id);
    jumpToMessage(`group-message-${targetMessage.id}`);
    setSearchParams(clearSearchJumpParams(searchParams), { replace: true });
  }, [searchJumpIntent, searchParams, selectedGroupId, selectedState, setSearchParams]);

  const selectedGroupPermissions =
    selectedState.status === "ready" ? selectedState.snapshot.group.permissions : null;
  useEffect(() => {
    if (selectedGroupPermissions === null) {
      return;
    }

    if (
      selectedGroupPermissions.creatableInviteRoles.length > 0 &&
      !selectedGroupPermissions.creatableInviteRoles.includes(inviteRole)
    ) {
      const nextInviteRole = selectedGroupPermissions.creatableInviteRoles[0];
      if (nextInviteRole) {
        setInviteRole(nextInviteRole);
      }
    }
  }, [inviteRole, selectedGroupPermissions]);

  if (authState.status !== "authenticated") {
    return null;
  }

  const activeInviteCount =
    selectedState.status === "ready"
      ? selectedState.inviteLinks.filter((inviteLink) => inviteLink.disabledAt === null).length
      : 0;
  const selectedSelfMember =
    selectedState.status === "ready"
      ? selectedState.members.find((member) => member.user.id === authState.profile.id) ?? null
      : null;
  const requestedJoinToken = extractGroupInviteToken(joinInput || joinTokenFromRoute);
  const threadMessages =
    selectedState.status === "ready" ? [...selectedState.messages].reverse() : [];
  const typingLabel =
    selectedState.status === "ready"
      ? describeGroupTypingLabel(selectedState.snapshot.typingState, authState.profile.id)
      : null;
  async function reloadGroups() {
    if (groupsStatus === "loading") {
      return;
    }

    setIsRefreshing(true);
    setActionError(null);

    try {
      const nextGroups = await gatewayClient.listGroups(token);
      setGroups(nextGroups);
      setGroupsStatus("ready");
      setGroupsError(null);
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось обновить список групп.",
        expireSession,
      );
      if (message !== null) {
        setGroupsStatus("error");
        setGroupsError(message);
      }
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = groupName.trim();
    if (normalizedName === "") {
      setActionError("Введите имя группы, прежде чем создавать её.");
      setNotice(null);
      return;
    }

    setIsCreatingGroup(true);
    setActionError(null);
    setNotice(null);

    try {
      const group = await gatewayClient.createGroup(token, normalizedName);
      setGroupName("");
      setComposerText("");
      setLastCreatedInvite(null);
      setNotice("Группа создана.");
      await reloadGroups();
      openGroup(group.id);
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось создать группу.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setIsCreatingGroup(false);
    }
  }

  async function handleJoinByInviteLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestedJoinToken === "") {
      setActionError("Вставьте invite link или raw invite token.");
      setNotice(null);
      return;
    }

    setIsJoining(true);
    setActionError(null);
    setNotice(null);

    try {
      const group = await gatewayClient.joinGroupByInviteLink(token, requestedJoinToken);
      setJoinInput(requestedJoinToken);
      setComposerText("");
      setLastCreatedInvite(null);
      setNotice("Вход в группу выполнен.");
      openGroup(group.id);
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось присоединиться к группе по invite link.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setIsJoining(false);
    }
  }

  async function handleCreateInviteLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedState.status !== "ready") {
      return;
    }

    setIsCreatingInviteLink(true);
    setActionError(null);
    setNotice(null);

    try {
      const createdInviteLink = await gatewayClient.createGroupInviteLink(
        token,
        selectedState.snapshot.group.id,
        inviteRole,
      );
      setLastCreatedInvite(createdInviteLink);
      setNotice("Invite link создан.");
      await reloadSelectedGroup(selectedState.snapshot.group.id, true);
      await reloadGroups();
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось создать invite link.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setIsCreatingInviteLink(false);
    }
  }

  async function handleDisableInviteLink(inviteLinkId: string) {
    if (selectedState.status !== "ready") {
      return;
    }

    setPendingDisableInviteId(inviteLinkId);
    setActionError(null);
    setNotice(null);

    try {
      await gatewayClient.disableGroupInviteLink(
        token,
        selectedState.snapshot.group.id,
        inviteLinkId,
      );
      setNotice("Invite link отозван.");
      await reloadSelectedGroup(selectedState.snapshot.group.id, true);
      await reloadGroups();
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось отозвать invite link.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setPendingDisableInviteId(null);
    }
  }

  async function handleSendGroupMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedState.status !== "ready") {
      return;
    }

    const normalizedText = normalizeComposerMessageText(composerText);
    if (!canSubmitGroupComposer) {
      setActionError(
        attachmentComposer.isUploading
          ? "Дождитесь завершения загрузки файла, прежде чем отправлять сообщение."
          : "Добавьте текст сообщения или готовое вложение.",
      );
      setNotice(null);
      return;
    }

    setIsSendingMessage(true);
    setActionError(null);
    setNotice(null);

    try {
      await gatewayClient.sendGroupTextMessage(
        token,
        selectedState.snapshot.group.id,
        normalizedText,
        attachmentComposer.uploadedAttachmentId === null
          ? []
          : [attachmentComposer.uploadedAttachmentId],
        selectedReplyMessage?.id ?? null,
      );
      setComposerText("");
      setSelectedReplyMessage(null);
      if (attachmentComposer.uploadedAttachmentId !== null) {
        attachmentComposer.markSendSucceeded();
      }
      setNotice("Сообщение отправлено.");
    } catch (error) {
      if (attachmentComposer.uploadedAttachmentId !== null) {
        attachmentComposer.markSendFailed();
      }
      const message = resolveProtectedError(
        error,
        "Не удалось отправить сообщение в группу.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setIsSendingMessage(false);
    }
  }

  async function handleSendGroupVoiceNote() {
    if (selectedState.status !== "ready" || voiceNoteRecorder.state.draft === null) {
      return;
    }

    if (isSendingMessage || attachmentComposer.isUploading) {
      return;
    }

    setIsSendingMessage(true);
    setActionError(null);
    setNotice(null);

    const recordedFile = voiceNoteRecorder.state.draft.file;
    let uploadedAttachmentId: string | null = null;
    voiceNoteRecorder.discardRecording();

    try {
      const uploadedAttachment = await attachmentComposer.selectFile(recordedFile);
      if (uploadedAttachment === null) {
        return;
      }
      uploadedAttachmentId = uploadedAttachment.id;

      await gatewayClient.sendGroupTextMessage(
        token,
        selectedState.snapshot.group.id,
        normalizeComposerMessageText(composerText),
        [uploadedAttachmentId],
        selectedReplyMessage?.id ?? null,
      );
      setComposerText("");
      setSelectedReplyMessage(null);
      attachmentComposer.markSendSucceeded();
      setNotice("Голосовая заметка отправлена.");
    } catch (error) {
      if (uploadedAttachmentId !== null) {
        attachmentComposer.markSendFailed();
      }
      const message = resolveProtectedError(
        error,
        "Не удалось отправить голосовую заметку в группу.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setIsSendingMessage(false);
    }
  }

  async function handleSendGroupVideoNote() {
    if (selectedState.status !== "ready" || videoNoteRecorder.state.draft === null) {
      return;
    }

    if (isSendingMessage || attachmentComposer.isUploading) {
      return;
    }

    setIsSendingMessage(true);
    setActionError(null);
    setNotice(null);

    const recordedFile = videoNoteRecorder.state.draft.file;
    let uploadedAttachmentId: string | null = null;
    videoNoteRecorder.discardRecording();

    try {
      const uploadedAttachment = await attachmentComposer.selectFile(recordedFile);
      if (uploadedAttachment === null) {
        return;
      }
      uploadedAttachmentId = uploadedAttachment.id;

      await gatewayClient.sendGroupTextMessage(
        token,
        selectedState.snapshot.group.id,
        normalizeComposerMessageText(composerText),
        [uploadedAttachmentId],
        selectedReplyMessage?.id ?? null,
      );
      setComposerText("");
      setSelectedReplyMessage(null);
      attachmentComposer.markSendSucceeded();
      setNotice("Видео заметка отправлена.");
    } catch (error) {
      if (uploadedAttachmentId !== null) {
        attachmentComposer.markSendFailed();
      }
      const message = resolveProtectedError(
        error,
        "Не удалось отправить видео заметку в группу.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setIsSendingMessage(false);
    }
  }

  async function handleSaveGroupMessageEdit(messageId: string) {
    if (selectedState.status !== "ready") {
      return;
    }

    const normalizedText = normalizeComposerMessageText(editingMessageText);
    if (normalizedText === "") {
      setActionError("Отредактированное сообщение не может быть полностью пустым.");
      setNotice(null);
      return;
    }

    setPendingEditMessageId(messageId);
    setActionError(null);
    setNotice(null);

    try {
      await gatewayClient.editGroupMessage(
        token,
        selectedState.snapshot.group.id,
        messageId,
        normalizedText,
      );
      setEditingMessageId(null);
      setEditingMessageText("");
      setNotice("Сообщение обновлено.");
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось сохранить изменения сообщения.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setPendingEditMessageId(null);
    }
  }

  async function handleAttachmentSelection(file: File | null) {
    if (file === null) {
      return;
    }

    setActionError(null);
    setNotice(null);
    await attachmentComposer.selectFile(file);
  }

  async function handleOpenAttachment(attachmentId: string) {
    setPendingOpenAttachmentId(attachmentId);
    setActionError(null);

    try {
      await openAttachmentInNewTab(token, attachmentId);
    } catch (error) {
      setActionError(
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : "Не удалось открыть вложение.",
      );
    } finally {
      setPendingOpenAttachmentId(null);
    }
  }

  async function handleDownloadAttachment(attachmentId: string, fileName: string) {
    setPendingOpenAttachmentId(attachmentId);
    setActionError(null);

    try {
      await downloadAttachment(token, attachmentId, fileName);
    } catch (error) {
      setActionError(
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : "Не удалось скачать вложение.",
      );
    } finally {
      setPendingOpenAttachmentId(null);
    }
  }

  async function handleUpdateGroupMemberRole(userId: string) {
    if (selectedState.status !== "ready") {
      return;
    }

    const member = selectedState.members.find((candidate) => candidate.user.id === userId);
    if (!member) {
      return;
    }

    const nextRole = memberRoleDrafts[userId] ?? member.role;
    if (nextRole === member.role) {
      return;
    }

    setPendingRoleUserId(userId);
    setActionError(null);
    setNotice(null);

    try {
      await gatewayClient.updateGroupMemberRole(
        token,
        selectedState.snapshot.group.id,
        userId,
        nextRole,
      );
      setNotice(`Роль ${member.user.nickname || `@${member.user.login}`} обновлена.`);
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось обновить роль участника.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setPendingRoleUserId(null);
    }
  }

  async function handleTransferOwnership(userId: string) {
    if (selectedState.status !== "ready") {
      return;
    }

    const member = selectedState.members.find((candidate) => candidate.user.id === userId);
    if (!member) {
      return;
    }
    if (
      !window.confirm(
        `Передать ownership участнику ${member.user.nickname || `@${member.user.login}`}? После этого ваша роль станет admin.`,
      )
    ) {
      return;
    }

    setPendingTransferUserId(userId);
    setActionError(null);
    setNotice(null);

    try {
      await gatewayClient.transferGroupOwnership(
        token,
        selectedState.snapshot.group.id,
        userId,
      );
      setNotice("Ownership передан. Текущая роль обновлена.");
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось передать ownership.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setPendingTransferUserId(null);
    }
  }

  async function handleRemoveGroupMember(userId: string) {
    if (selectedState.status !== "ready") {
      return;
    }

    const member = selectedState.members.find((candidate) => candidate.user.id === userId);
    if (!member) {
      return;
    }
    if (
      !window.confirm(
        `Удалить участника ${member.user.nickname || `@${member.user.login}`} из группы?`,
      )
    ) {
      return;
    }

    setPendingRemoveUserId(userId);
    setActionError(null);
    setNotice(null);

    try {
      await gatewayClient.removeGroupMember(token, selectedState.snapshot.group.id, userId);
      setNotice(`Участник ${member.user.nickname || `@${member.user.login}`} удалён из группы.`);
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось удалить участника.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setPendingRemoveUserId(null);
    }
  }

  async function handleSetGroupRestriction(userId: string, restricted: boolean) {
    if (selectedState.status !== "ready") {
      return;
    }

    const member = selectedState.members.find((candidate) => candidate.user.id === userId);
    if (!member) {
      return;
    }

    const confirmMessage = restricted
      ? `Ограничить отправку сообщений для ${member.user.nickname || `@${member.user.login}`}?`
      : `Снять ограничение на отправку сообщений для ${member.user.nickname || `@${member.user.login}`}?`;
    if (!window.confirm(confirmMessage)) {
      return;
    }

    setPendingRestrictionUserId(userId);
    setActionError(null);
    setNotice(null);

    try {
      if (restricted) {
        await gatewayClient.restrictGroupMember(token, selectedState.snapshot.group.id, userId);
        setNotice(
          `Отправка сообщений ограничена для ${member.user.nickname || `@${member.user.login}`}.`,
        );
      } else {
        await gatewayClient.unrestrictGroupMember(token, selectedState.snapshot.group.id, userId);
        setNotice(
          `Ограничение на отправку снято для ${member.user.nickname || `@${member.user.login}`}.`,
        );
      }
    } catch (error) {
      const message = resolveProtectedError(
        error,
        restricted
          ? "Не удалось ограничить отправку сообщений."
          : "Не удалось снять ограничение на отправку сообщений.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setPendingRestrictionUserId(null);
    }
  }

  async function handleLeaveGroup() {
    if (selectedState.status !== "ready") {
      return;
    }
    if (!window.confirm("Покинуть текущую группу?")) {
      return;
    }

    setIsLeavingGroup(true);
    setActionError(null);
    setNotice(null);

    try {
      await gatewayClient.leaveGroup(token, selectedState.snapshot.group.id);
      setNotice("Вы вышли из группы.");
      clearGroupSelection();
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось покинуть группу.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setIsLeavingGroup(false);
    }
  }

  async function reloadSelectedGroup(groupId: string, active: boolean) {
    try {
      const snapshot = await gatewayClient.getGroupChat(token, groupId);
      const membersPromise = gatewayClient.listGroupMembers(token, groupId);
      const messagesPromise = gatewayClient.listGroupMessages(token, groupId);
      const inviteLinksPromise = snapshot.group.permissions.canManageInviteLinks
        ? gatewayClient.listGroupInviteLinks(token, groupId)
        : Promise.resolve([]);
      const [members, messages, inviteLinks] = await Promise.all([
        membersPromise,
        messagesPromise,
        inviteLinksPromise,
      ]);
      if (!active) {
        return;
      }

      setSelectedState({
        status: "ready",
        snapshot,
        members,
        inviteLinks,
        messages,
        errorMessage: null,
      });
      setMemberRoleDrafts(buildMemberRoleDrafts(members));
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось открыть group chat через gateway.",
        expireSession,
      );
      if (!active || message === null) {
        return;
      }

      setSelectedState({
        status: "error",
        snapshot: null,
        members: [],
        inviteLinks: [],
        messages: [],
        errorMessage: message,
      });
      setMemberRoleDrafts({});
    }
  }

  function openGroup(groupId: string) {
    const params = new URLSearchParams();
    params.set("group", groupId);
    setSearchParams(params, { replace: true });
  }

  function clearGroupSelection() {
    setSearchParams(new URLSearchParams(), { replace: true });
    setComposerText("");
  }

  return (
    <div className={styles.layout}>
      <section className={styles.heroCard}>
        <div className={styles.heroHeader}>
          <div>
            <p className={styles.cardLabel}>Groups</p>
            <h1 className={styles.title}>Group attachment composer bootstrap</h1>
            <p className={styles.subtitle}>
              Slice делает group chat usable для реальных файлов: upload intent, presigned upload,
              lazy inline preview для image/audio/video attachments и send через существующий
              gateway-only flow.
            </p>
          </div>

          <button
            className={styles.secondaryButton}
            disabled={groupsStatus === "loading" || isRefreshing}
            onClick={() => {
              void reloadGroups();
            }}
            type="button"
          >
            {isRefreshing ? "Обновляем..." : "Обновить"}
          </button>
        </div>

        <div className={styles.metrics}>
          <Metric label="Группы" value={groups.length} />
          <Metric
            label="В thread"
            value={selectedState.status === "ready" ? selectedState.messages.length : 0}
          />
          <Metric label="Активные invite links" value={activeInviteCount} />
        </div>

      {notice && <div className={styles.notice}>{notice}</div>}
      {searchJumpNotice && <div className={styles.notice}>{searchJumpNotice}</div>}
      {actionError && <div className={styles.error}>{actionError}</div>}

        <div className={styles.heroForms}>
          <form className={styles.panelCard} onSubmit={handleCreateGroup}>
            <div className={styles.joinHeader}>
              <div>
                <p className={styles.cardLabel}>Create</p>
                <h2 className={styles.panelTitle}>Создать новую группу</h2>
              </div>
              <span className={styles.rolePill}>owner</span>
            </div>

            <p className={styles.description}>
              Создание группы сразу bootstrap'ит owner membership и primary message thread.
            </p>

            <div className={styles.form}>
              <label className={styles.field}>
                <span>Имя группы</span>
                <input
                  maxLength={80}
                  onChange={(event) => setGroupName(event.target.value)}
                  placeholder="Ops Room"
                  value={groupName}
                />
              </label>

              <button
                className={styles.primaryButton}
                disabled={isCreatingGroup}
                type="submit"
              >
                {isCreatingGroup ? "Создаём..." : "Создать"}
              </button>
            </div>
          </form>

          <form className={styles.joinCard} onSubmit={handleJoinByInviteLink}>
            <div className={styles.joinHeader}>
              <div>
                <p className={styles.cardLabel}>Join</p>
                <h2 className={styles.panelTitle}>Войти по invite link</h2>
              </div>
              {joinTokenFromRoute !== "" && <span className={styles.rolePill}>из URL</span>}
            </div>

            <p className={styles.description}>
              Вставьте полную ссылку или raw token. Публичного discovery по-прежнему нет.
            </p>

            <div className={styles.form}>
              <label className={styles.field}>
                <span>Invite link или token</span>
                <textarea
                  onChange={(event) => setJoinInput(event.target.value)}
                  placeholder="https://aerochat.local/app/groups?join=ginv_..."
                  value={joinInput}
                />
              </label>

              <button className={styles.primaryButton} disabled={isJoining} type="submit">
                {isJoining ? "Входим..." : "Присоединиться"}
              </button>
            </div>
          </form>
        </div>
      </section>

      <div className={styles.workspace}>
        <aside className={styles.sideColumn}>
          <section className={styles.panelCard}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.cardLabel}>Список</p>
                <h2 className={styles.panelTitle}>Ваши группы</h2>
              </div>
              <p className={styles.panelCopy}>
                List view остаётся membership-scoped и идёт только через `ChatService` на gateway.
              </p>
            </div>

            {groupsStatus === "loading" && (
              <InlineState
                title="Подтягиваем группы"
                message="Запрашиваем membership-scoped список групп через gateway."
              />
            )}

            {groupsStatus === "error" && (
              <InlineState
                title="Список групп недоступен"
                message={groupsError ?? "Не удалось получить группы."}
                action={
                  <button
                    className={styles.primaryButton}
                    onClick={() => {
                      void reloadGroups();
                    }}
                    type="button"
                  >
                    Повторить
                  </button>
                }
                tone="error"
              />
            )}

            {groupsStatus === "ready" && groups.length === 0 && (
              <p className={styles.emptyState}>
                Вы ещё не состоите ни в одной группе. Создайте новую группу или войдите по invite
                link.
              </p>
            )}

            {groupsStatus === "ready" && groups.length > 0 && (
              <div className={styles.list}>
                {groups.map((group) => (
                  <button
                    key={group.id}
                    className={styles.groupButton}
                    onClick={() => openGroup(group.id)}
                    type="button"
                  >
                    <article
                      className={styles.groupCard}
                      data-active={group.id === selectedGroupId}
                    >
                      <div className={styles.groupHeader}>
                        <div>
                          <h3 className={styles.groupTitle}>{group.name}</h3>
                          <p className={styles.groupMeta}>
                            {group.memberCount} участников • роль {roleLabel(group.selfRole)}
                          </p>
                        </div>
                        <div className={styles.badgeColumn}>
                          {group.unreadCount > 0 && (
                            <span className={styles.unreadPill}>
                              Непрочитано: {group.unreadCount}
                            </span>
                          )}
                          <span className={styles.rolePill}>{roleLabel(group.selfRole)}</span>
                        </div>
                      </div>
                    </article>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>

        <section className={styles.mainColumn}>
          {selectedState.status === "idle" && (
            <InlineState
              title="Группа не выбрана"
              message="Откройте группу из списка слева или используйте explicit join по invite link."
            />
          )}

          {selectedState.status === "loading" && (
            <InlineState
              title="Открываем группу"
              message="Загружаем metadata, primary thread, участников и историю сообщений."
            />
          )}

          {selectedState.status === "error" && (
            <InlineState
              title="Группа сейчас недоступна"
              message={selectedState.errorMessage}
              action={
                <button
                  className={styles.secondaryButton}
                  onClick={clearGroupSelection}
                  type="button"
                >
                  Вернуться к списку
                </button>
              }
              tone="error"
            />
          )}

          {selectedState.status === "ready" && (
            <>
              <section className={styles.panelCard}>
                <div className={styles.splitHeader}>
                  <div>
                    <p className={styles.cardLabel}>Group shell</p>
                    <h2 className={styles.panelTitle}>{selectedState.snapshot.group.name}</h2>
                    <p className={styles.description}>
                      Текущая роль: {roleLabel(selectedState.snapshot.group.selfRole)}. Thread key:{" "}
                      `{selectedState.snapshot.thread.threadKey}`.
                    </p>
                  </div>

                  <div className={styles.badgeColumn}>
                    <span className={styles.statusPill}>
                      {selectedState.snapshot.thread.canSendMessages
                        ? "write allowed"
                        : selectedSelfMember?.isWriteRestricted
                          ? "write restricted"
                          : "read only"}
                    </span>
                    {selectedState.snapshot.group.permissions.canLeaveGroup && (
                      <button
                        className={styles.dangerButton}
                        disabled={isLeavingGroup}
                        onClick={() => {
                          void handleLeaveGroup();
                        }}
                        type="button"
                      >
                        {isLeavingGroup ? "Выходим..." : "Покинуть группу"}
                      </button>
                    )}
                    <button
                      className={styles.secondaryButton}
                      onClick={clearGroupSelection}
                      type="button"
                    >
                      Закрыть
                    </button>
                  </div>
                </div>
              </section>

              <section className={styles.panelCard}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.cardLabel}>Timeline</p>
                    <h2 className={styles.panelTitle}>Primary group thread</h2>
                  </div>
                  <p className={styles.panelCopy}>
                    Thread показывает текст, polished file cards и inline preview для
                    image/audio/video attachments, но без media processing pipeline.
                  </p>
                </div>

                <div className={styles.timelineMeta}>
                  <span className={styles.statusPill}>{threadMessages.length} сообщений</span>
                  <span className={styles.statusPill}>
                    updated {formatDateTime(selectedState.snapshot.thread.updatedAt)}
                  </span>
                  {typingLabel && <span className={styles.statusPill}>{typingLabel}</span>}
                </div>

                <div className={styles.messagesList}>
                  {threadMessages.length === 0 ? (
                    <InlineState
                      title="Сообщений пока нет"
                      message="Primary thread уже создан, но ни text-only, ни attachment-only сообщений пока нет."
                    />
                    ) : (
                      threadMessages.map((message) => {
                        const isOwn = message.senderUserId === authState.profile.id;
                        const canEdit = isGroupMessageEditable(message, authState.profile.id);
                        const isEditing = editingMessageId === message.id;
                        const hasMessageText = hasRenderableMessageText(message.text);
                        const hasAttachments = message.attachments.length > 0;
                        const isEditPending = pendingEditMessageId === message.id;

                      return (
                        <article
                          className={styles.messageCard}
                          data-own={isOwn}
                          data-search-target={highlightedMessageId === message.id}
                          id={`group-message-${message.id}`}
                          key={message.id}
                        >
                          <div className={styles.messageHeader}>
                            <div>
                              <p className={styles.messageAuthor}>
                                {describeMessageAuthor(
                                  message.senderUserId,
                                  authState.profile.id,
                                  selectedState.members,
                                )}
                              </p>
                              <p className={styles.messageMeta}>
                                {formatDateTime(message.createdAt)}
                              </p>
                            </div>
                            <div className={styles.badgeColumn}>
                              <span className={styles.statusPill}>
                                {describeGroupMessageKind(message)}
                              </span>
                              {message.editedAt && (
                                <span className={styles.statusPill}>Изменено</span>
                              )}
                            </div>
                          </div>

                          {(hasMessageText || hasAttachments) && (
                            <div className={styles.messageBody}>
                              {isEditing ? (
                                <>
                                  <label className={`${styles.field} ${styles.editField}`}>
                                    <span>Текст сообщения</span>
                                    <textarea
                                      disabled={isEditPending}
                                      maxLength={4000}
                                      onChange={(event) => {
                                        setEditingMessageText(event.target.value);
                                        setActionError(null);
                                        setNotice(null);
                                      }}
                                      rows={4}
                                      value={editingMessageText}
                                    />
                                  </label>

                                  {hasAttachments && (
                                    <p className={styles.editHint}>
                                      Вложения остаются без изменений, редактируется только текст.
                                    </p>
                                  )}
                                </>
                              ) : (
                                <>
                                  {message.replyPreview && (
                                    <button
                                      className={styles.replyPreviewCard}
                                      onClick={() => {
                                        jumpToMessage(`group-message-${message.replyPreview?.messageId ?? ""}`);
                                      }}
                                      type="button"
                                    >
                                      <span className={styles.replyPreviewAuthor}>
                                        {describeGroupReplyPreviewAuthor(
                                          message.replyPreview,
                                          authState.profile.id,
                                        )}
                                      </span>
                                      <span className={styles.replyPreviewText}>
                                        {describeReplyPreviewText(message.replyPreview)}
                                      </span>
                                    </button>
                                  )}
                                  {hasMessageText && (
                                    <div className={styles.messageText}>
                                      <SafeMessageMarkdown text={message.text?.text ?? ""} />
                                    </div>
                                  )}
                                </>
                              )}

                              {hasAttachments && (
                                <MessageAttachmentList
                                  accessToken={token}
                                  attachments={message.attachments}
                                  onDownloadAttachment={(attachment) => {
                                    void handleDownloadAttachment(
                                      attachment.id,
                                      attachment.fileName,
                                    );
                                  }}
                                  onOpenAttachment={(attachmentId) => {
                                    void handleOpenAttachment(attachmentId);
                                  }}
                                  pendingAttachmentId={pendingOpenAttachmentId}
                                  tone={isOwn ? "own" : "other"}
                                />
                              )}
                            </div>
                          )}

                          <div className={styles.actions}>
                            {isEditing ? (
                              <>
                                <button
                                  className={styles.primaryButton}
                                  disabled={isEditPending}
                                  onClick={() => {
                                    void handleSaveGroupMessageEdit(message.id);
                                  }}
                                  type="button"
                                >
                                  {isEditPending ? "Сохраняем..." : "Сохранить"}
                                </button>
                                <button
                                  className={styles.secondaryButton}
                                  disabled={isEditPending}
                                  onClick={() => {
                                    setEditingMessageId(null);
                                    setEditingMessageText("");
                                    setActionError(null);
                                    setNotice(null);
                                  }}
                                  type="button"
                                >
                                  Отмена
                                </button>
                              </>
                            ) : (
                              <>
                                {canEdit && (
                                  <button
                                    className={styles.secondaryButton}
                                    onClick={() => {
                                      setEditingMessageId(message.id);
                                      setEditingMessageText(message.text?.text ?? "");
                                      setActionError(null);
                                      setNotice(null);
                                    }}
                                    type="button"
                                  >
                                    Редактировать
                                  </button>
                                )}

                                <button
                                  className={styles.ghostButton}
                                  onClick={() => {
                                    setSelectedReplyMessage(message);
                                    setActionError(null);
                                    setNotice(null);
                                  }}
                                  type="button"
                                >
                                  Ответить
                                </button>
                              </>
                            )}
                          </div>

                          {message.editedAt && (
                            <p className={styles.editMeta}>
                              Последнее редактирование: {formatDateTime(message.editedAt)}
                            </p>
                          )}
                        </article>
                      );
                    })
                  )}
                </div>
              </section>

              <section className={styles.panelCard}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.cardLabel}>Composer</p>
                    <h2 className={styles.panelTitle}>Новое сообщение</h2>
                  </div>
                  <p className={styles.panelCopy}>
                    Raw HTML запрещён. Файл или записанная голосовая заметка загружаются отдельно,
                    а single-file composer допускает text-only, text + attachment и attachment-only
                    сообщения.
                  </p>
                </div>

                {!selectedState.snapshot.thread.canSendMessages && (
                  <div className={styles.readOnlyNotice}>
                    {selectedSelfMember?.isWriteRestricted
                      ? "Для текущего участника включено backend-ограничение на отправку сообщений и typing."
                      : "Роль `reader` видит историю группы, но не может отправлять сообщения."}
                  </div>
                )}

                <form className={styles.composer} onSubmit={handleSendGroupMessage}>
                  {selectedReplyMessage && (
                    <div className={styles.replyComposerCard}>
                      <div>
                        <p className={styles.replyPreviewAuthor}>
                          Ответ на{" "}
                          {describeMessageAuthor(
                            selectedReplyMessage.senderUserId,
                            authState.profile.id,
                            selectedState.members,
                          )}
                        </p>
                        <p className={styles.replyPreviewText}>
                          {describeGroupComposerReplyTarget(selectedReplyMessage)}
                        </p>
                      </div>
                      <button
                        className={styles.ghostButton}
                        onClick={() => {
                          setSelectedReplyMessage(null);
                        }}
                        type="button"
                      >
                        Отменить reply
                      </button>
                    </div>
                  )}

                  <div className={styles.attachmentActions}>
                    <input
                      accept="*/*"
                      className={styles.attachmentInput}
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        void handleAttachmentSelection(file);
                        event.target.value = "";
                      }}
                      ref={attachmentInputRef}
                      type="file"
                    />
                    <button
                      className={styles.secondaryButton}
                      disabled={!canPickAttachment}
                      onClick={() => {
                        attachmentInputRef.current?.click();
                      }}
                      type="button"
                    >
                      {attachmentComposer.state.draft === null
                        ? "Выбрать файл"
                        : "Заменить файл"}
                    </button>
                    <span className={styles.attachmentHint}>
                      Single-file composer: файл, voice note или video note можно отправить и без
                      текста после upload.
                    </span>
                  </div>

                  <VoiceNoteRecorderPanel
                    discardDisabled={isSendingMessage}
                    isSending={isSendingMessage}
                    onDiscard={() => {
                      voiceNoteRecorder.discardRecording();
                    }}
                    onSend={() => {
                      void handleSendGroupVoiceNote();
                    }}
                    onStart={() => {
                      void voiceNoteRecorder.startRecording();
                    }}
                    onStop={() => {
                      voiceNoteRecorder.stopRecording();
                    }}
                    sendDisabled={
                      isSendingMessage ||
                      attachmentComposer.isUploading ||
                      !selectedState.snapshot.thread.canSendMessages
                    }
                    startDisabled={!canRecordVoiceNote}
                    state={voiceNoteRecorder.state}
                    stopDisabled={isSendingMessage}
                  />

                  <VideoNoteRecorderPanel
                    discardDisabled={isSendingMessage}
                    isSending={isSendingMessage}
                    onDiscard={() => {
                      videoNoteRecorder.discardRecording();
                    }}
                    onSend={() => {
                      void handleSendGroupVideoNote();
                    }}
                    onStart={() => {
                      void videoNoteRecorder.startRecording();
                    }}
                    onStop={() => {
                      videoNoteRecorder.stopRecording();
                    }}
                    sendDisabled={
                      isSendingMessage ||
                      attachmentComposer.isUploading ||
                      !selectedState.snapshot.thread.canSendMessages
                    }
                    startDisabled={!canRecordVideoNote}
                    state={videoNoteRecorder.state}
                    stopDisabled={isSendingMessage}
                  />

                  {attachmentComposer.state.draft && (
                    <div className={styles.attachmentDraftCard}>
                      <div>
                        <p className={styles.attachmentDraftTitle}>
                          {attachmentComposer.state.draft.fileName}
                        </p>
                        <p className={styles.attachmentDraftMeta}>
                          {formatAttachmentSize(attachmentComposer.state.draft.sizeBytes)} •{" "}
                          {describeAttachmentMimeType(attachmentComposer.state.draft.mimeType)}
                        </p>
                        {attachmentComposer.state.draft.status === "preparing" && (
                          <p className={styles.attachmentDraftStatus}>
                            Подготавливаем upload intent...
                          </p>
                        )}
                        {attachmentComposer.state.draft.status === "uploading" && (
                          <p className={styles.attachmentDraftStatus}>
                            Загружаем: {attachmentComposer.state.draft.progress}%
                          </p>
                        )}
                        {attachmentComposer.state.draft.status === "uploaded" && (
                          <p className={styles.attachmentDraftStatus}>
                            Файл загружен и будет прикреплён к следующему сообщению.
                          </p>
                        )}
                        {attachmentComposer.state.draft.status === "error" && (
                          <p className={styles.attachmentDraftError}>
                            {attachmentComposer.state.draft.errorMessage ??
                              "Не удалось загрузить файл."}
                          </p>
                        )}
                      </div>

                      <div className={styles.attachmentDraftActions}>
                        {attachmentComposer.state.draft.status === "error" && (
                          <button
                            className={styles.ghostButton}
                            onClick={() => {
                              void attachmentComposer.retryUpload();
                            }}
                            type="button"
                          >
                            Повторить upload
                          </button>
                        )}
                        <button
                          className={styles.ghostButton}
                          onClick={() => {
                            attachmentComposer.removeDraft();
                          }}
                          type="button"
                        >
                          Убрать
                        </button>
                      </div>
                    </div>
                  )}

                  <label className={styles.field}>
                    <span>Текст сообщения</span>
                    <textarea
                      disabled={
                        isSendingMessage ||
                        attachmentComposer.isUploading ||
                        !selectedState.snapshot.thread.canSendMessages
                      }
                      maxLength={4000}
                      onChange={(event) => {
                        setComposerText(event.target.value);
                        setActionError(null);
                      }}
                      placeholder={
                        selectedState.snapshot.thread.canSendMessages
                          ? "Напишите текстовое сообщение в primary thread"
                          : "Эта роль читает историю без отправки"
                      }
                      rows={5}
                      value={composerText}
                    />
                  </label>

                  <div className={styles.composerFooter}>
                    <span className={styles.characterCount}>{composerText.trim().length}/4000</span>
                    <button
                      className={styles.primaryButton}
                      disabled={
                        isSendingMessage ||
                        !canSubmitGroupComposer
                      }
                      type="submit"
                    >
                      {isSendingMessage ? "Отправляем..." : "Отправить"}
                    </button>
                  </div>
                </form>
              </section>

              <section className={styles.panelCard}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.cardLabel}>Members</p>
                    <h2 className={styles.panelTitle}>Участники группы</h2>
                  </div>
                  <p className={styles.panelCopy}>
                    Список участников доступен всем membership roles, включая `reader`. В этом
                    slice owner управляет ролями, а admin получает bounded remove/restrict powers
                    без обхода owner-only invariants.
                  </p>
                </div>

                {selectedState.snapshot.group.selfRole === "owner" ? (
                  <div className={styles.notice}>
                    Ownership нельзя потерять неявно. Чтобы owner вышел из группы, сначала нужен
                    явный `TransferGroupOwnership`, затем обычный `LeaveGroup`.
                  </div>
                ) : (
                  <p className={styles.helperText}>
                    Текущая роль может только просматривать roster и при необходимости выполнить
                    self-leave.
                  </p>
                )}

                {selectedState.members.length === 0 ? (
                  <p className={styles.emptyState}>Backend пока не вернул участников группы.</p>
                ) : (
                  <div className={styles.memberList}>
                    {selectedState.members.map((member) => {
                      const isCurrentUser = member.user.id === authState.profile.id;
                      const draftRole = memberRoleDrafts[member.user.id] ?? member.role;
                      const permissions = selectedState.snapshot.group.permissions;
                      const canAdjustRole =
                        permissions.canManageMemberRoles &&
                        !isCurrentUser &&
                        permissions.roleManagementTargetRoles.includes(member.role);
                      const canTransferOwnership =
                        permissions.canTransferOwnership &&
                        !isCurrentUser &&
                        member.role !== "owner" &&
                        !member.isWriteRestricted;
                      const canRemoveMember =
                        !isCurrentUser &&
                        permissions.removableMemberRoles.includes(member.role);
                      const canRestrictMember =
                        !isCurrentUser &&
                        !member.isWriteRestricted &&
                        permissions.restrictableMemberRoles.includes(member.role);
                      const canUnrestrictMember =
                        !isCurrentUser &&
                        member.isWriteRestricted &&
                        permissions.restrictableMemberRoles.includes(member.role);

                      return (
                        <article className={styles.memberCard} key={member.user.id}>
                          <div className={styles.memberHeader}>
                            <div>
                              <strong>{member.user.nickname}</strong>
                              <p className={styles.groupMeta}>@{member.user.login}</p>
                              <p className={styles.helperText}>
                                В группе с {formatDateTime(member.joinedAt)}
                                {isCurrentUser ? " • это вы" : ""}
                              </p>
                              {member.isWriteRestricted && (
                                <p className={styles.helperText}>
                                  Ограничение на отправку активно
                                  {member.writeRestrictedAt
                                    ? ` с ${formatDateTime(member.writeRestrictedAt)}`
                                    : "."}
                                </p>
                              )}
                            </div>
                            <span className={styles.rolePill}>{roleLabel(member.role)}</span>
                          </div>

                          {(canAdjustRole ||
                            canTransferOwnership ||
                            canRemoveMember ||
                            canRestrictMember ||
                            canUnrestrictMember) && (
                            <div className={styles.memberActions}>
                              {canAdjustRole && (
                                <label className={styles.field}>
                                  <span>Новая роль</span>
                                  <select
                                    onChange={(event) =>
                                      setMemberRoleDrafts((current) => ({
                                        ...current,
                                        [member.user.id]: event.target.value as GroupMemberRole,
                                      }))
                                    }
                                    value={draftRole}
                                  >
                                    {permissions.assignableRoles.map((role) => (
                                      <option key={role} value={role}>
                                        {role}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}

                              <div className={styles.memberButtons}>
                                {canAdjustRole && (
                                  <button
                                    className={styles.secondaryButton}
                                    disabled={
                                      pendingRoleUserId === member.user.id || draftRole === member.role
                                    }
                                    onClick={() => {
                                      void handleUpdateGroupMemberRole(member.user.id);
                                    }}
                                    type="button"
                                  >
                                    {pendingRoleUserId === member.user.id
                                      ? "Сохраняем..."
                                      : "Обновить роль"}
                                  </button>
                                )}

                                {canTransferOwnership && (
                                  <button
                                    className={styles.secondaryButton}
                                    disabled={pendingTransferUserId === member.user.id}
                                    onClick={() => {
                                      void handleTransferOwnership(member.user.id);
                                    }}
                                    type="button"
                                  >
                                    {pendingTransferUserId === member.user.id
                                      ? "Передаём..."
                                      : "Передать ownership"}
                                  </button>
                                )}

                                {(canRestrictMember || canUnrestrictMember) && (
                                  <button
                                    className={styles.secondaryButton}
                                    disabled={pendingRestrictionUserId === member.user.id}
                                    onClick={() => {
                                      void handleSetGroupRestriction(
                                        member.user.id,
                                        !member.isWriteRestricted,
                                      );
                                    }}
                                    type="button"
                                  >
                                    {pendingRestrictionUserId === member.user.id
                                      ? "Сохраняем..."
                                      : member.isWriteRestricted
                                        ? "Снять restriction"
                                        : "Ограничить write"}
                                  </button>
                                )}

                                {canRemoveMember && (
                                  <button
                                    className={styles.dangerButton}
                                    disabled={pendingRemoveUserId === member.user.id}
                                    onClick={() => {
                                      void handleRemoveGroupMember(member.user.id);
                                    }}
                                    type="button"
                                  >
                                    {pendingRemoveUserId === member.user.id
                                      ? "Удаляем..."
                                      : "Удалить"}
                                  </button>
                                )}
                              </div>
                            </div>
                          )}

                          {!canAdjustRole &&
                            !canTransferOwnership &&
                            !canRestrictMember &&
                            !canUnrestrictMember &&
                            !canRemoveMember &&
                            isCurrentUser && (
                              <p className={styles.helperText}>
                                {selectedState.snapshot.group.selfRole === "owner"
                                  ? "Owner не может покинуть группу без явной передачи ownership."
                                  : "Для self-leave используйте кнопку в верхней панели группы."}
                              </p>
                            )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className={styles.panelCard}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.cardLabel}>Invite links</p>
                    <h2 className={styles.panelTitle}>Role-scoped invite links</h2>
                  </div>
                  <p className={styles.panelCopy}>
                    Invite links по-прежнему управляются только `owner`/`admin`.
                  </p>
                </div>

                {!selectedState.snapshot.group.permissions.canManageInviteLinks && (
                  <p className={styles.emptyState}>
                    Текущая роль не управляет invite links. Для этого требуется `owner` или
                    `admin`.
                  </p>
                )}

                {selectedState.snapshot.group.permissions.canManageInviteLinks && (
                  <>
                    <form className={styles.form} onSubmit={handleCreateInviteLink}>
                      <label className={styles.field}>
                        <span>Роль по invite link</span>
                        <select
                          onChange={(event) =>
                            setInviteRole(event.target.value as GroupMemberRole)
                          }
                          value={inviteRole}
                        >
                          {selectedState.snapshot.group.permissions.creatableInviteRoles.map(
                            (role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ),
                          )}
                        </select>
                      </label>

                      <button
                        className={styles.primaryButton}
                        disabled={isCreatingInviteLink}
                        type="submit"
                      >
                        {isCreatingInviteLink ? "Создаём..." : "Создать invite link"}
                      </button>
                    </form>

                    {lastCreatedInvite && (
                      <article className={styles.inviteCard}>
                        <div className={styles.inviteHeader}>
                          <div>
                            <strong>Последний созданный invite link</strong>
                            <p className={styles.groupMeta}>
                              Роль: {roleLabel(lastCreatedInvite.inviteLink.role)}
                            </p>
                          </div>
                          <span className={styles.statusPill}>new</span>
                        </div>

                        <p className={styles.inviteValue}>
                          {buildGroupInviteUrl(lastCreatedInvite.inviteToken)}
                        </p>
                      </article>
                    )}

                    {selectedState.inviteLinks.length === 0 ? (
                      <p className={styles.emptyState}>
                        Для этой группы ещё нет созданных invite links.
                      </p>
                    ) : (
                      <div className={styles.inviteList}>
                        {selectedState.inviteLinks.map((inviteLink) => (
                          <article className={styles.inviteCard} key={inviteLink.id}>
                            <div className={styles.inviteHeader}>
                              <div>
                                <strong>{roleLabel(inviteLink.role)}</strong>
                                <p className={styles.groupMeta}>
                                  join count: {inviteLink.joinCount} • создано{" "}
                                  {formatDateTime(inviteLink.createdAt)}
                                </p>
                              </div>

                              <span
                                className={styles.statusPill}
                                data-tone={inviteLink.disabledAt ? "danger" : "default"}
                              >
                                {inviteLink.disabledAt ? "disabled" : "active"}
                              </span>
                            </div>

                            <div className={styles.inviteActions}>
                              <p className={styles.helperText}>
                                {inviteLink.disabledAt
                                  ? `Отключён ${formatDateTime(inviteLink.disabledAt)}`
                                  : "Ссылка активна и готова к explicit join."}
                              </p>

                              <button
                                className={styles.dangerButton}
                                disabled={
                                  inviteLink.disabledAt !== null ||
                                  pendingDisableInviteId === inviteLink.id
                                }
                                onClick={() => {
                                  void handleDisableInviteLink(inviteLink.id);
                                }}
                                type="button"
                              >
                                {pendingDisableInviteId === inviteLink.id
                                  ? "Отзываем..."
                                  : "Отозвать"}
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </section>
      </div>
    </div>
  );

  function describeMessageAuthor(
    senderUserId: string,
    currentUserId: string,
    members: GroupMember[],
  ): string {
    if (senderUserId === currentUserId) {
      return "Вы";
    }

    const member = members.find((candidate) => candidate.user.id === senderUserId);
    if (!member) {
      return "Участник группы";
    }

    return member.user.nickname || `@${member.user.login}`;
  }
}

interface MetricProps {
  label: string;
  value: number;
}

function replaceSelectedGroupTypingState(
  setSelectedState: Dispatch<SetStateAction<GroupsSelectedState>>,
  groupId: string,
  threadId: string,
  typingState: GroupTypingState | null,
) {
  setSelectedState((current) => {
    if (current.status !== "ready") {
      return current;
    }
    if (
      current.snapshot.group.id !== groupId ||
      current.snapshot.thread.id !== threadId
    ) {
      return current;
    }

    return {
      status: "ready",
      snapshot: {
        ...current.snapshot,
        typingState,
      },
      members: current.members,
      inviteLinks: current.inviteLinks,
      messages: current.messages,
      errorMessage: null,
    };
  });
}

async function clearGroupTypingSilently(
  token: string,
  target: GroupTypingSessionTarget,
  setSelectedState: Dispatch<SetStateAction<GroupsSelectedState>>,
  onUnauthenticated: () => void,
) {
  try {
    const typingState = await gatewayClient.clearGroupTyping(
      token,
      target.groupId,
      target.threadId,
    );
    replaceSelectedGroupTypingState(
      setSelectedState,
      target.groupId,
      target.threadId,
      typingState,
    );
  } catch (error) {
    handleGroupTypingAuthError(error, onUnauthenticated);
  }
}

function handleGroupTypingAuthError(
  error: unknown,
  onUnauthenticated: () => void,
): boolean {
  if (isGatewayErrorCode(error, "unauthenticated")) {
    onUnauthenticated();
    return true;
  }

  return false;
}

function clearGroupTypingRefreshTimer(ref: { current: number | null }) {
  if (ref.current === null) {
    return;
  }

  window.clearTimeout(ref.current);
  ref.current = null;
}

function clearGroupTypingIdleTimer(ref: { current: number | null }) {
  if (ref.current === null) {
    return;
  }

  window.clearTimeout(ref.current);
  ref.current = null;
}

function usePageVisibility(): boolean {
  const [isPageVisible, setIsPageVisible] = useState(() => {
    if (typeof document === "undefined") {
      return true;
    }

    return document.visibilityState !== "hidden";
  });

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const handleVisibilityChange = () => {
      setIsPageVisible(document.visibilityState !== "hidden");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return isPageVisible;
}

function Metric({ label, value }: MetricProps) {
  return (
    <div className={styles.metricCard}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

interface InlineStateProps {
  title: string;
  message: string;
  action?: ReactNode;
  tone?: "default" | "error";
}

function InlineState({
  title,
  message,
  action,
  tone = "default",
}: InlineStateProps) {
  return (
    <section className={styles.stateCard} data-tone={tone}>
      <p className={styles.cardLabel}>Groups state</p>
      <h3 className={styles.stateTitle}>{title}</h3>
      <p className={styles.stateMessage}>{message}</p>
      {action && <div className={styles.actions}>{action}</div>}
    </section>
  );
}

function buildMemberRoleDrafts(members: GroupMember[]): Record<string, GroupMemberRole> {
  return members.reduce<Record<string, GroupMemberRole>>((acc, member) => {
    acc[member.user.id] = member.role;
    return acc;
  }, {});
}

function roleLabel(role: GroupMemberRole): string {
  switch (role) {
    case "owner":
      return "owner";
    case "admin":
      return "admin";
    case "member":
      return "member";
    case "reader":
      return "reader";
    default:
      return role;
  }
}

function describeGroupMessageKind(message: { text: { text: string } | null; attachments: { id: string }[] }): string {
  if (hasRenderableMessageText(message.text) && message.attachments.length > 0) {
    return "Текст + файл";
  }
  if (message.attachments.length > 0) {
    return "Только файл";
  }
  return "Текст";
}

function isGroupMessageEditable(
  message: GroupMessage,
  currentUserId: string,
): boolean {
  return message.senderUserId === currentUserId && message.text !== null;
}

function describeGroupReplyPreviewAuthor(
  preview: GroupMessage["replyPreview"],
  currentUserId: string,
): string {
  if (!preview?.author) {
    if (preview?.isDeleted) {
      return "Удалённое сообщение";
    }
    if (preview?.isUnavailable) {
      return "Недоступное сообщение";
    }
    return "Ответ";
  }
  if (preview.author.id === currentUserId) {
    return "Вы";
  }
  return preview.author.nickname || preview.author.login;
}

function describeReplyPreviewText(preview: GroupMessage["replyPreview"]): string {
  if (!preview) {
    return "";
  }
  if (preview.isDeleted) {
    return "Сообщение удалено.";
  }
  if (preview.isUnavailable) {
    return "Исходное сообщение больше недоступно.";
  }
  if (preview.hasText && preview.textPreview.trim() !== "") {
    return preview.textPreview;
  }
  if (preview.attachmentCount > 0) {
    return preview.attachmentCount === 1
      ? "Вложение"
      : `Вложения: ${preview.attachmentCount}`;
  }
  return "Пустой preview";
}

function describeGroupComposerReplyTarget(message: GroupMessage): string {
  const normalizedText = normalizeComposerMessageText(message.text?.text ?? "");
  if (normalizedText !== "") {
    return normalizedText.length > 140 ? `${normalizedText.slice(0, 137)}...` : normalizedText;
  }
  if (message.attachments.length > 0) {
    return message.attachments.length === 1
      ? "Вложение"
      : `Вложения: ${message.attachments.length}`;
  }
  return "Сообщение без текста";
}

function jumpToMessage(elementId: string) {
  if (elementId.trim() === "") {
    return;
  }

  const element = document.getElementById(elementId);
  if (!element) {
    return;
  }

  element.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
}

function formatDateTime(value: string): string {
  if (value.trim() === "") {
    return "неизвестно";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function resolveProtectedError(
  error: unknown,
  fallbackMessage: string,
  onUnauthenticated: () => void,
): string | null {
  if (isGatewayErrorCode(error, "unauthenticated")) {
    onUnauthenticated();
    return null;
  }

  return describeGatewayError(error, fallbackMessage);
}
