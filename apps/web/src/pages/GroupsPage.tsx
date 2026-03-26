import {
  useCallback,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useSearchParams } from "react-router-dom";
import { normalizeComposerMessageText } from "../attachments/message-content";
import { describeAttachmentMimeType, formatAttachmentSize } from "../attachments/metadata";
import { VideoNoteRecorderPanel } from "../attachments/VideoNoteRecorderPanel";
import { VoiceNoteRecorderPanel } from "../attachments/VoiceNoteRecorderPanel";
import { useVideoNoteRecorder } from "../attachments/useVideoNoteRecorder";
import { useVoiceNoteRecorder } from "../attachments/useVoiceNoteRecorder";
import { useAuth } from "../auth/useAuth";
import { EncryptedMessageAttachmentList } from "../chats/EncryptedMessageAttachmentList";
import { SafeMessageMarkdown } from "../chats/SafeMessageMarkdown";
import { useEncryptedMediaAttachmentDraft } from "../chats/useEncryptedMediaAttachmentDraft";
import type { CryptoContextState } from "../crypto/runtime-context";
import { useCryptoRuntime } from "../crypto/useCryptoRuntime";
import { gatewayClient } from "../gateway/runtime";
import {
  describeGatewayError,
  isRTCActiveCallConflict,
  isGatewayErrorCode,
  type CreatedGroupInviteLink,
  type Group,
  type GroupMember,
  type GroupMemberRole,
  type GroupTypingState,
  type RtcCallParticipant,
} from "../gateway/types";
import { buildGroupInviteUrl, extractGroupInviteToken } from "../groups/invite-token";
import { parseGroupRealtimeEvent } from "../groups/realtime";
import {
  describeEncryptedGroupLaneIssue,
} from "../groups/useEncryptedGroupLane";
import { subscribeEncryptedGroupRealtimeEvents } from "../groups/encrypted-group-realtime";
import type {
  EncryptedGroupProjectionEntry,
  EncryptedGroupProjectedMessageEntry,
} from "../groups/encrypted-group-projection";
import { publishLocalEncryptedGroupProjection } from "../groups/encrypted-group-local-outbound";
import {
  applyGroupRealtimeToGroups,
  applyGroupRealtimeToSelectedState,
  createInitialGroupsSelectedState,
  shouldClearSelectedGroupOnRealtimeEvent,
  type GroupsSelectedState,
} from "../groups/state";
import { useEncryptedGroupLane } from "../groups/useEncryptedGroupLane";
import {
  describeGroupTypingLabel,
  GROUP_TYPING_IDLE_TIMEOUT_MS,
  GROUP_TYPING_REFRESH_INTERVAL_MS,
  resolveGroupTypingSessionTarget,
  type GroupTypingSessionTarget,
} from "../groups/typing";
import { subscribeRealtimeEnvelopes } from "../realtime/events";
import {
  deriveGroupCallActionAvailability,
  deriveGroupCallUiPhase,
  describeGroupCallConflictMessage,
  type GroupCallActionState,
  type GroupCallTerminalState,
} from "../rtc/group-call-state";
import {
  createInitialGroupCallAwarenessState,
  groupCallAwarenessReducer,
  selectGroupCallAwarenessEntry,
  selectGroupCallAwarenessGroupIdsByCallId,
  type GroupCallAwarenessEntry,
} from "../rtc/group-awareness";
import { parseRTCRealtimeEvent } from "../rtc/realtime";
import {
  clearSearchJumpParams,
  findJumpTarget,
  readSearchJumpIntent,
} from "../search/jump";
import { primeEncryptedGroupLocalSearchIndex } from "../search/encrypted-local-search";
import { useDesktopShellHost } from "../shell/context";
import styles from "./GroupsPage.module.css";

export function GroupsPage() {
  const refreshActiveGroupCallsIntervalMs = 5000;
  const { state: authState, expireSession } = useAuth();
  const desktopShellHost = useDesktopShellHost();
  const cryptoRuntime = useCryptoRuntime();
  const [searchParams, setSearchParams] = useSearchParams();
  const [mobileWindowContentMode, setMobileWindowContentMode] = useState<"thread" | "info">(
    "thread",
  );
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
  const [encryptedComposerText, setEncryptedComposerText] = useState("");
  const [encryptedComposerError, setEncryptedComposerError] = useState<string | null>(null);
  const [editingEncryptedMessageId, setEditingEncryptedMessageId] = useState<string | null>(null);
  const [selectedEncryptedReplyMessageId, setSelectedEncryptedReplyMessageId] =
    useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<GroupMemberRole>("member");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isCreatingInviteLink, setIsCreatingInviteLink] = useState(false);
  const [pendingDisableInviteId, setPendingDisableInviteId] = useState<string | null>(null);
  const [pendingRoleUserId, setPendingRoleUserId] = useState<string | null>(null);
  const [pendingRestrictionUserId, setPendingRestrictionUserId] = useState<string | null>(null);
  const [pendingRemoveUserId, setPendingRemoveUserId] = useState<string | null>(null);
  const [pendingTransferUserId, setPendingTransferUserId] = useState<string | null>(null);
  const [isLeavingGroup, setIsLeavingGroup] = useState(false);
  const [groupCallActionState, setGroupCallActionState] =
    useState<GroupCallActionState>("idle");
  const [groupCallTerminalState, setGroupCallTerminalState] =
    useState<GroupCallTerminalState>("idle");
  const [groupCallError, setGroupCallError] = useState<string | null>(null);
  const [memberRoleDrafts, setMemberRoleDrafts] = useState<Record<string, GroupMemberRole>>({});
  const [lastCreatedInvite, setLastCreatedInvite] = useState<CreatedGroupInviteLink | null>(null);
  const [searchJumpNotice, setSearchJumpNotice] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const selectedStateRef = useRef(selectedState);
  const groupsRef = useRef(groups);
  const [groupCallAwarenessState, dispatchGroupCallAwareness] = useReducer(
    groupCallAwarenessReducer,
    undefined,
    createInitialGroupCallAwarenessState,
  );
  const groupCallAwarenessStateRef = useRef(groupCallAwarenessState);
  const previousSelectedGroupCallIdRef = useRef<string | null>(null);
  const encryptedAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const activeTypingTargetRef = useRef<GroupTypingSessionTarget | null>(null);
  const typingLastSentAtRef = useRef(0);
  const typingRefreshTimerRef = useRef<number | null>(null);
  const typingIdleTimerRef = useRef<number | null>(null);
  const isPageVisible = usePageVisibility();

  const selectedGroupId = searchParams.get("group")?.trim() ?? "";
  const joinTokenFromRoute = searchParams.get("join")?.trim() ?? "";
  const searchJumpIntent = readSearchJumpIntent(searchParams);
  const token = authState.status === "authenticated" ? authState.token : "";
  const encryptedGroupLane = useEncryptedGroupLane({
    enabled: authState.status === "authenticated",
    token,
    groupId: selectedGroupId === "" ? null : selectedGroupId,
  });
  const activeTypingTarget = resolveGroupTypingSessionTarget({
    enabled: authState.status === "authenticated",
    pageVisible: isPageVisible,
    selectedGroupId,
    snapshotGroupId: selectedState.status === "ready" ? selectedState.snapshot.group.id : null,
    threadId: selectedState.status === "ready" ? selectedState.snapshot.thread.id : null,
    canSendMessages:
      selectedState.status === "ready" ? selectedState.snapshot.thread.canSendMessages : false,
    composerText: "",
  });
  const encryptedMediaAttachmentDraft = useEncryptedMediaAttachmentDraft({
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
  const encryptedAttachmentDraft = encryptedMediaAttachmentDraft.draft;
  const uploadedEncryptedAttachmentDraft = encryptedMediaAttachmentDraft.uploadedDraft;
  const discardEncryptedMediaNoteDrafts = useEffectEvent(() => {
    voiceNoteRecorder.discardRecording();
    videoNoteRecorder.discardRecording();
  });

  useEffect(() => {
    selectedStateRef.current = selectedState;
  }, [selectedState]);

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  useEffect(() => {
    groupCallAwarenessStateRef.current = groupCallAwarenessState;
  }, [groupCallAwarenessState]);

  useEffect(() => {
    setEditingEncryptedMessageId(null);
    setSelectedEncryptedReplyMessageId(null);
    setEncryptedComposerText("");
    setEncryptedComposerError(null);
    setGroupCallActionState("idle");
    setGroupCallTerminalState("idle");
    setGroupCallError(null);
    previousSelectedGroupCallIdRef.current = null;
    setSearchJumpNotice(null);
    setHighlightedMessageId(null);
    discardEncryptedMediaNoteDrafts();
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

  const groupMembershipKey = [...groups]
    .map((group) => group.id)
    .sort((left, right) => left.localeCompare(right))
    .join("|");

  const refreshAllActiveGroupCalls = useCallback(
    async (showLoading = false, explicitGroups: Group[] | null = null) => {
      if (authState.status !== "authenticated") {
        return;
      }

      if (showLoading) {
        dispatchGroupCallAwareness({ type: "full_sync_started" });
      }

      try {
        const targetGroups = explicitGroups ?? groupsRef.current;
        if (targetGroups.length === 0) {
          dispatchGroupCallAwareness({
            type: "full_sync_succeeded",
            activeEntries: [],
          });
          return;
        }

        const activeEntries = (
          await Promise.all<GroupCallAwarenessEntry | null>(
            targetGroups.map(async (group) => {
              const call = await gatewayClient.getActiveCall(token, {
                kind: "group",
                groupId: group.id,
              });
              if (call === null || call.scope.kind !== "group") {
                return null;
              }

              const participants = await gatewayClient.listCallParticipants(token, call.id);
              return {
                groupId: group.id,
                call,
                participants,
                syncStatus: "ready",
                errorMessage: null,
              };
            }),
          )
        ).filter((entry): entry is GroupCallAwarenessEntry => entry !== null);

        dispatchGroupCallAwareness({
          type: "full_sync_succeeded",
          activeEntries,
        });
      } catch (error) {
        dispatchGroupCallAwareness({
          type: "full_sync_failed",
          message: resolveProtectedError(
            error,
            "Не удалось обновить active group calls из RTC control plane.",
            expireSession,
          ) ?? "Не удалось обновить active group calls из RTC control plane.",
        });
      }
    },
    [authState.status, expireSession, token],
  );

  useEffect(() => {
    if (authState.status !== "authenticated" || groupsStatus !== "ready") {
      return;
    }

    void refreshAllActiveGroupCalls(false);
  }, [authState.status, groupMembershipKey, groupsStatus, refreshAllActiveGroupCalls]);

  const refreshGroupCall = useCallback(
    async (groupId: string) => {
      const normalizedGroupId = groupId.trim();
      if (authState.status !== "authenticated" || normalizedGroupId === "") {
        return;
      }

      try {
        const call = await gatewayClient.getActiveCall(token, {
          kind: "group",
          groupId: normalizedGroupId,
        });
        const participants =
          call === null ? [] : await gatewayClient.listCallParticipants(token, call.id);

        dispatchGroupCallAwareness({
          type: "group_sync_succeeded",
          groupId: normalizedGroupId,
          call,
          participants,
        });
      } catch (error) {
        dispatchGroupCallAwareness({
          type: "group_sync_failed",
          groupId: normalizedGroupId,
          message:
            resolveProtectedError(
              error,
              "Не удалось обновить group-call состояние для выбранной группы.",
              expireSession,
            ) ?? "Не удалось обновить group-call состояние для выбранной группы.",
        });
      }
    },
    [authState.status, expireSession, token],
  );

  useEffect(() => {
    if (authState.status !== "authenticated") {
      return;
    }
    if (selectedGroupId === "") {
      setSelectedState(createInitialGroupsSelectedState());
      setEditingEncryptedMessageId(null);
      setSelectedEncryptedReplyMessageId(null);
      setEncryptedComposerText("");
      setEncryptedComposerError(null);
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
        const inviteLinksPromise = snapshot.group.permissions.canManageInviteLinks
          ? gatewayClient.listGroupInviteLinks(token, selectedGroupId)
          : Promise.resolve([]);
        const [members, inviteLinks] = await Promise.all([
          membersPromise,
          inviteLinksPromise,
        ]);
        if (!active) {
          return;
        }

        const encryptedReadState = snapshot.encryptedReadState;

        setSelectedState({
          status: "ready",
          snapshot: {
            ...snapshot,
            group: snapshot.group,
            readState: snapshot.readState,
            encryptedReadState,
          },
          members,
          inviteLinks,
          messages: [],
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

  useEffect(() => {
    if (authState.status !== "authenticated") {
      return;
    }

    return subscribeRealtimeEnvelopes((envelope) => {
      const event = parseGroupRealtimeEvent(envelope);
      if (!event) {
        return;
      }

      if (event.type === "group.message.updated") {
        // Readable legacy group realtime payload больше не должен оживлять
        // active group thread или live group list после de-scope plaintext path.
        return;
      }

      setGroups((current) => applyGroupRealtimeToGroups(current, event));

      const shouldClearSelection = shouldClearSelectedGroupOnRealtimeEvent(
        selectedStateRef.current,
        event,
      );
      if (shouldClearSelection) {
        setSearchParams(new URLSearchParams(), { replace: true });
        setNotice("Live state: доступ к группе больше не активен.");
      }

      const nextSelectedState = applyGroupRealtimeToSelectedState(
        selectedStateRef.current,
        event,
      );
      selectedStateRef.current = nextSelectedState;
      setSelectedState(nextSelectedState);

      if (nextSelectedState?.status === "ready") {
        setMemberRoleDrafts(buildMemberRoleDrafts(nextSelectedState.members));
        return;
      }

      setMemberRoleDrafts({});
    });
  }, [authState.status, setSearchParams]);

  useEffect(() => {
    if (authState.status !== "authenticated") {
      return;
    }

    return subscribeRealtimeEnvelopes((envelope) => {
      const event = parseRTCRealtimeEvent(envelope);
      if (event === null || event.type === "rtc.signal.received") {
        return;
      }

      if (event.type === "rtc.call.updated") {
        if (event.call.scope.kind === "group" && event.call.scope.groupId !== null) {
          void refreshGroupCall(event.call.scope.groupId);
        }
        return;
      }

      const groupIdByCallId = selectGroupCallAwarenessGroupIdsByCallId(
        groupCallAwarenessStateRef.current,
      );
      const targetGroupId = groupIdByCallId[event.callId] ?? null;
      if (targetGroupId !== null) {
        void refreshGroupCall(targetGroupId);
        return;
      }

      void refreshAllActiveGroupCalls(false);
    });
  }, [authState.status, refreshAllActiveGroupCalls, refreshGroupCall]);

  useEffect(() => {
    if (authState.status !== "authenticated" || selectedGroupId === "") {
      return;
    }

    void refreshGroupCall(selectedGroupId);
  }, [authState.status, refreshGroupCall, selectedGroupId]);

  useEffect(() => {
    if (
      authState.status !== "authenticated" ||
      !isPageVisible ||
      Object.keys(groupCallAwarenessState.activeCallsByGroupId).length === 0
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshAllActiveGroupCalls(false);
    }, refreshActiveGroupCallsIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    authState.status,
    groupCallAwarenessState.activeCallsByGroupId,
    isPageVisible,
    refreshAllActiveGroupCalls,
  ]);

  useEffect(() => {
    if (authState.status !== "authenticated") {
      return;
    }

    return subscribeEncryptedGroupRealtimeEvents((event) => {
      const unreadCount = event.envelope.viewerDelivery.unreadState?.unreadCount ?? null;

      setGroups((current) =>
        [...current]
          .map((group) =>
            group.id !== event.envelope.groupId
              ? group
              : {
                  ...group,
                  updatedAt:
                    event.envelope.storedAt > group.updatedAt
                      ? event.envelope.storedAt
                      : group.updatedAt,
                  encryptedUnreadCount:
                    unreadCount === null ? group.encryptedUnreadCount : unreadCount,
                },
          )
          .sort((left, right) => {
            if (left.updatedAt === right.updatedAt) {
              return right.id.localeCompare(left.id);
            }

            return right.updatedAt.localeCompare(left.updatedAt);
          }),
      );

      setSelectedState((current) => {
        if (current.status !== "ready" || current.snapshot.group.id !== event.envelope.groupId) {
          return current;
        }

        const nextState = {
          ...current,
          snapshot: {
            ...current.snapshot,
            group: {
              ...current.snapshot.group,
              updatedAt:
                event.envelope.storedAt > current.snapshot.group.updatedAt
                  ? event.envelope.storedAt
                  : current.snapshot.group.updatedAt,
              encryptedUnreadCount:
                unreadCount === null
                  ? current.snapshot.group.encryptedUnreadCount
                  : unreadCount,
            },
          },
        };
        selectedStateRef.current = nextState;
        return nextState;
      });
    });
  }, [authState.status]);

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

          const nextState = {
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
          selectedStateRef.current = nextState;
          return nextState;
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

  const encryptedMessageEntries = encryptedGroupLane.items.filter(
    (
      entry,
    ): entry is EncryptedGroupProjectedMessageEntry => entry.kind === "message",
  );
  const latestEncryptedGroupMessage = encryptedMessageEntries.at(-1) ?? null;
  const activeEncryptedGroupId =
    selectedState.status === "ready" ? selectedState.snapshot.group.id : null;
  const shouldAutoMarkEncryptedGroupRead =
    authState.status === "authenticated" &&
    isPageVisible &&
    selectedState.status === "ready" &&
    encryptedGroupLane.status === "ready" &&
    latestEncryptedGroupMessage !== null &&
    latestEncryptedGroupMessage.senderUserId !== authState.profile.id &&
    selectedState.snapshot.encryptedReadState?.selfPosition?.messageId !==
      latestEncryptedGroupMessage.messageId;

  useEffect(() => {
    if (selectedState.status !== "ready" || encryptedGroupLane.status !== "ready") {
      return;
    }

    primeEncryptedGroupLocalSearchIndex({
      group: selectedState.snapshot.group,
      bootstrap: encryptedGroupLane.bootstrap,
      items: encryptedGroupLane.items,
    });
  }, [encryptedGroupLane.bootstrap, encryptedGroupLane.items, encryptedGroupLane.status, selectedState]);

  useEffect(() => {
    if (searchJumpIntent === null || selectedState.status !== "ready") {
      return;
    }

    if (selectedState.snapshot.group.id !== selectedGroupId) {
      return;
    }

    if (searchJumpIntent.lane === "encrypted") {
      if (encryptedGroupLane.status === "idle" || encryptedGroupLane.status === "loading") {
        return;
      }

      if (encryptedGroupLane.status !== "ready") {
        setSearchJumpNotice(
          encryptedGroupLane.errorMessage ??
            "Encrypted search result нельзя открыть: local encrypted group lane недоступен в текущем browser profile.",
        );
        setHighlightedMessageId(null);
        setSearchParams(clearSearchJumpParams(searchParams), { replace: true });
        return;
      }

      const encryptedTarget =
        encryptedMessageEntries.find((entry) => entry.messageId === searchJumpIntent.messageId) ??
        null;
      if (encryptedTarget === null) {
        setSearchJumpNotice(
          "Найденное encrypted сообщение пока не попало в текущее локально загруженное окно group lane. Deep history backfill в этом slice не реализован.",
        );
        setHighlightedMessageId(null);
        setSearchParams(clearSearchJumpParams(searchParams), { replace: true });
        return;
      }

      setSearchJumpNotice(null);
      setHighlightedMessageId(encryptedTarget.messageId);
      jumpToMessage(`encrypted-group-message-${encryptedTarget.messageId}`);
      setSearchParams(clearSearchJumpParams(searchParams), { replace: true });
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
  }, [
    encryptedGroupLane.errorMessage,
    encryptedGroupLane.status,
    encryptedMessageEntries,
    searchJumpIntent,
    searchParams,
    selectedGroupId,
    selectedState,
    setSearchParams,
  ]);

  useEffect(() => {
    if (
      !shouldAutoMarkEncryptedGroupRead ||
      activeEncryptedGroupId === null ||
      latestEncryptedGroupMessage === null
    ) {
      return;
    }

    let cancelled = false;

    void gatewayClient
      .markEncryptedGroupChatRead(token, activeEncryptedGroupId, latestEncryptedGroupMessage.messageId)
      .then((readUpdate) => {
        if (cancelled) {
          return;
        }

        setSelectedState((current) => {
          if (current.status !== "ready" || current.snapshot.group.id !== activeEncryptedGroupId) {
            return current;
          }

          const nextState = {
            ...current,
            snapshot: {
              ...current.snapshot,
              group: {
                ...current.snapshot.group,
                encryptedUnreadCount: readUpdate.unreadCount,
              },
              encryptedReadState: readUpdate.readState,
            },
          };
          selectedStateRef.current = nextState;
          return nextState;
        });

        setGroups((current) =>
          current.map((group) =>
            group.id !== activeEncryptedGroupId
              ? group
              : {
                  ...group,
                  encryptedUnreadCount: readUpdate.unreadCount,
                },
          ),
        );
      })
      .catch((error) => {
        resolveProtectedError(
          error,
          "Не удалось обновить encrypted group read state через gateway.",
          expireSession,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeEncryptedGroupId,
    expireSession,
    latestEncryptedGroupMessage,
    shouldAutoMarkEncryptedGroupRead,
    token,
  ]);

  const selectedGroupPermissions =
    selectedState.status === "ready" ? selectedState.snapshot.group.permissions : null;
  const selectedGroupCallEntry = selectGroupCallAwarenessEntry(
    groupCallAwarenessState,
    selectedGroupId === "" ? null : selectedGroupId,
  );
  const selectedGroupCallParticipants = sortGroupCallParticipants(
    selectedGroupCallEntry?.participants ?? [],
    selectedState.status === "ready" ? selectedState.members : [],
    authState.status === "authenticated" ? authState.profile.id : "",
  );
  const selectedGroupCallSelfParticipant =
    authState.status !== "authenticated"
      ? null
      : selectedGroupCallParticipants.find(
          (participant) =>
            participant.userId === authState.profile.id && participant.state === "active",
        ) ?? null;
  const selectedGroupCallActions =
    authState.status !== "authenticated" || selectedState.status !== "ready"
      ? null
      : deriveGroupCallActionAvailability({
          actionState: groupCallActionState,
          call: selectedGroupCallEntry?.call ?? null,
          currentUserId: authState.profile.id,
          selfParticipant: selectedGroupCallSelfParticipant,
          selfRole: selectedState.snapshot.group.selfRole,
        });
  const selectedGroupCallPhase = deriveGroupCallUiPhase({
    actionState: groupCallActionState,
    call: selectedGroupCallEntry?.call ?? null,
    selfParticipant: selectedGroupCallSelfParticipant,
    terminalState: groupCallTerminalState,
  });

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

  useEffect(() => {
    const currentCallId = selectedGroupCallEntry?.call.id ?? null;
    const previousCallId = previousSelectedGroupCallIdRef.current;
    if (
      previousCallId !== null &&
      currentCallId === null &&
      groupCallActionState === "idle" &&
      groupCallError === null
    ) {
      setGroupCallTerminalState("ended");
    }

    previousSelectedGroupCallIdRef.current = currentCallId;
  }, [groupCallActionState, groupCallError, selectedGroupCallEntry?.call.id]);

  const selectedGroupTitle =
    selectedState.status === "ready"
      ? selectedState.snapshot.group.name
      : "Группа";
  const groupWindowContentMode =
    desktopShellHost?.activeWindowContentMode ?? mobileWindowContentMode;
  const isDesktopTargetWindow = desktopShellHost !== null && selectedGroupId !== "";

  useEffect(() => {
    if (desktopShellHost === null || selectedState.status !== "ready") {
      return;
    }

    desktopShellHost.syncCurrentRouteTitle(selectedGroupTitle);
  }, [desktopShellHost, selectedGroupTitle, selectedState]);

  useEffect(() => {
    setMobileWindowContentMode("thread");
  }, [selectedGroupId]);

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
  const encryptedThreadMessages =
    selectedState.status === "ready" ? [...encryptedGroupLane.items].reverse() : [];
  const encryptedMessageIndex = new Map(
    encryptedMessageEntries.map((entry) => [entry.messageId, entry] as const),
  );
  const selectedEncryptedReplyEntry =
    selectedEncryptedReplyMessageId === null
      ? null
      : encryptedMessageIndex.get(selectedEncryptedReplyMessageId) ?? null;
  const editingEncryptedEntry =
    editingEncryptedMessageId === null
      ? null
      : encryptedMessageIndex.get(editingEncryptedMessageId) ?? null;
  const encryptedPinnedMessages =
    selectedState.status !== "ready"
      ? []
      : selectedState.snapshot.group.encryptedPinnedMessageIds.map((messageId) => ({
          messageId,
          entry: encryptedMessageIndex.get(messageId) ?? null,
        }));
  const canPickEncryptedAttachment =
    selectedState.status === "ready" &&
    encryptedGroupLane.status === "ready" &&
    encryptedGroupLane.bootstrap !== null &&
    selectedState.snapshot.thread.canSendMessages &&
    !cryptoRuntime.state.isActionPending &&
    !encryptedMediaAttachmentDraft.isUploading &&
    editingEncryptedEntry === null;
  const canUseEncryptedMediaNoteEntry =
    selectedState.status === "ready" &&
    encryptedGroupLane.status === "ready" &&
    encryptedGroupLane.bootstrap !== null &&
    selectedState.snapshot.thread.canSendMessages &&
    !cryptoRuntime.state.isActionPending &&
    !encryptedMediaAttachmentDraft.isUploading &&
    editingEncryptedEntry === null;
  const voiceNoteStartDisabled =
    !canUseEncryptedMediaNoteEntry ||
    videoNoteRecorder.state.status === "requesting_permission" ||
    videoNoteRecorder.state.status === "recording" ||
    videoNoteRecorder.state.status === "processing" ||
    videoNoteRecorder.state.status === "recorded";
  const videoNoteStartDisabled =
    !canUseEncryptedMediaNoteEntry ||
    voiceNoteRecorder.state.status === "requesting_permission" ||
    voiceNoteRecorder.state.status === "recording" ||
    voiceNoteRecorder.state.status === "processing" ||
    voiceNoteRecorder.state.status === "recorded";
  const canSendEncryptedGroupText =
    selectedState.status === "ready" &&
    encryptedGroupLane.status === "ready" &&
    encryptedGroupLane.bootstrap !== null &&
    selectedState.snapshot.thread.canSendMessages &&
    !cryptoRuntime.state.isActionPending &&
    !encryptedMediaAttachmentDraft.isUploading &&
    (editingEncryptedEntry !== null
      ? normalizeComposerMessageText(encryptedComposerText) !== "" &&
        uploadedEncryptedAttachmentDraft === null
      : normalizeComposerMessageText(encryptedComposerText) !== "" ||
          uploadedEncryptedAttachmentDraft !== null);
  const encryptedSendHint = describeEncryptedGroupBootstrapSendHint({
    groupSelected: selectedState.status === "ready",
    composerText: encryptedComposerText,
    encryptedAttachmentDraft,
    isEditingEncryptedMessage: editingEncryptedEntry !== null,
    hasEncryptedReplyTarget: selectedEncryptedReplyEntry !== null,
    cryptoRuntimeState: cryptoRuntime.state,
  });
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
      await refreshAllActiveGroupCalls(false, nextGroups);
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

  async function handleStartGroupCall() {
    if (selectedState.status !== "ready" || selectedGroupCallActions?.canStart !== true) {
      return;
    }

    setGroupCallActionState("starting");
    setGroupCallTerminalState("idle");
    setGroupCallError(null);

    try {
      await gatewayClient.startCall(token, {
        kind: "group",
        groupId: selectedState.snapshot.group.id,
      });
      await refreshGroupCall(selectedState.snapshot.group.id);
    } catch (error) {
      if (isRTCActiveCallConflict(error)) {
        setGroupCallTerminalState("failed");
        setGroupCallError(describeGroupCallConflictMessage("start"));
        return;
      }
      if (isGatewayErrorCode(error, "failed_precondition")) {
        await refreshGroupCall(selectedState.snapshot.group.id);
        setGroupCallTerminalState("failed");
        setGroupCallError(
          "Для этой группы уже существует активный звонок. Можно открыть lobby и присоединиться.",
        );
        return;
      }

      const message = resolveProtectedError(
        error,
        "Не удалось запустить групповой звонок.",
        expireSession,
      );
      if (message !== null) {
        setGroupCallTerminalState("failed");
        setGroupCallError(message);
      }
    } finally {
      setGroupCallActionState("idle");
    }
  }

  async function handleJoinGroupCall() {
    if (
      selectedState.status !== "ready" ||
      selectedGroupCallEntry === null ||
      selectedGroupCallActions?.canJoin !== true
    ) {
      return;
    }

    setGroupCallActionState("joining");
    setGroupCallTerminalState("idle");
    setGroupCallError(null);

    try {
      await gatewayClient.joinCall(token, selectedGroupCallEntry.call.id);
      await refreshGroupCall(selectedState.snapshot.group.id);
    } catch (error) {
      if (isRTCActiveCallConflict(error)) {
        setGroupCallTerminalState("failed");
        setGroupCallError(describeGroupCallConflictMessage("join"));
        return;
      }

      const message = resolveProtectedError(
        error,
        "Не удалось присоединиться к групповому звонку.",
        expireSession,
      );
      if (message !== null) {
        setGroupCallTerminalState("failed");
        setGroupCallError(message);
      }
    } finally {
      setGroupCallActionState("idle");
    }
  }

  async function handleLeaveGroupCall() {
    if (
      selectedState.status !== "ready" ||
      selectedGroupCallEntry === null ||
      selectedGroupCallActions?.canLeave !== true
    ) {
      return;
    }

    setGroupCallActionState("leaving");
    setGroupCallTerminalState("idle");
    setGroupCallError(null);

    try {
      await gatewayClient.leaveCall(token, selectedGroupCallEntry.call.id);
      await refreshGroupCall(selectedState.snapshot.group.id);
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось покинуть групповой звонок.",
        expireSession,
      );
      if (message !== null) {
        setGroupCallTerminalState("failed");
        setGroupCallError(message);
      }
    } finally {
      setGroupCallActionState("idle");
    }
  }

  async function handleEndGroupCall() {
    if (
      selectedState.status !== "ready" ||
      selectedGroupCallEntry === null ||
      selectedGroupCallActions?.canEnd !== true
    ) {
      return;
    }

    setGroupCallActionState("ending");
    setGroupCallTerminalState("idle");
    setGroupCallError(null);

    try {
      await gatewayClient.endCall(token, selectedGroupCallEntry.call.id);
      await refreshGroupCall(selectedState.snapshot.group.id);
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось завершить групповой звонок.",
        expireSession,
      );
      if (message !== null) {
        setGroupCallTerminalState("failed");
        setGroupCallError(message);
      }
    } finally {
      setGroupCallActionState("idle");
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

  async function handleSendEncryptedGroupMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedState.status !== "ready") {
      return;
    }

    if (encryptedGroupLane.status !== "ready" || encryptedGroupLane.bootstrap === null) {
      setEncryptedComposerError(
        encryptedGroupLane.errorMessage ??
          "Сообщения группы пока не готовы к отправке.",
      );
      setNotice(null);
      return;
    }
    if (!selectedState.snapshot.thread.canSendMessages) {
      setEncryptedComposerError(
        selectedSelfMember?.isWriteRestricted
          ? "Для этого участника отправка сообщений сейчас отключена."
          : "Текущая роль не может отправлять сообщения.",
      );
      setNotice(null);
      return;
    }
    const normalizedText = normalizeComposerMessageText(encryptedComposerText);
    if (
      editingEncryptedEntry !== null &&
      (encryptedAttachmentDraft !== null || uploadedEncryptedAttachmentDraft !== null)
    ) {
      setEncryptedComposerError(
        "Нельзя добавить новый файл во время редактирования. Сначала уберите вложение.",
      );
      setNotice(null);
      return;
    }
    if (normalizedText === "" && uploadedEncryptedAttachmentDraft === null) {
      setEncryptedComposerError(
        "Добавьте текст или подготовьте файл для отправки.",
      );
      setNotice(null);
      return;
    }

    setEncryptedComposerError(null);
    setActionError(null);
    setNotice(null);

    try {
      const attachmentDrafts =
        uploadedEncryptedAttachmentDraft === null ? [] : [uploadedEncryptedAttachmentDraft];
      const result =
        editingEncryptedEntry !== null
          ? await cryptoRuntime.sendEncryptedGroupEdit(
              selectedState.snapshot.group.id,
              editingEncryptedEntry.messageId,
              editingEncryptedEntry.revision + 1,
              normalizedText,
              selectedEncryptedReplyEntry?.messageId ?? null,
            )
          : await cryptoRuntime.sendEncryptedGroupContent(
              selectedState.snapshot.group.id,
              normalizedText,
              selectedEncryptedReplyEntry?.messageId ?? null,
              attachmentDrafts,
            );
      if (result === null) {
        return;
      }

      publishLocalEncryptedGroupProjection(result.localProjection);
      setEncryptedComposerText("");
      setSelectedEncryptedReplyMessageId(null);
      setEditingEncryptedMessageId(null);
      encryptedMediaAttachmentDraft.markSendSucceeded();
      setNotice(
        editingEncryptedEntry !== null
          ? "Изменения сохранены."
          : attachmentDrafts.length > 0
            ? "Сообщение с файлом отправлено."
            : "Сообщение отправлено.",
      );
    } catch (error) {
      encryptedMediaAttachmentDraft.markSendFailed();
      setEncryptedComposerError(
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : "Не удалось отправить сообщение.",
      );
    }
  }

  async function handleDeleteEncryptedGroupMessage(
    message: EncryptedGroupProjectedMessageEntry,
  ) {
    if (selectedState.status !== "ready") {
      return;
    }

    setEncryptedComposerError(null);
    setActionError(null);
    setNotice(null);

    try {
      const result = await cryptoRuntime.sendEncryptedGroupTombstone(
        selectedState.snapshot.group.id,
        message.messageId,
        message.revision + 1,
      );
      if (result === null) {
        return;
      }

      publishLocalEncryptedGroupProjection(result.localProjection);
      if (editingEncryptedMessageId === message.messageId) {
        setEditingEncryptedMessageId(null);
        setEncryptedComposerText("");
      }
      if (selectedEncryptedReplyMessageId === message.messageId) {
        setSelectedEncryptedReplyMessageId(null);
      }
      setNotice("Сообщение удалено для всех.");
    } catch (error) {
      setEncryptedComposerError(
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : "Не удалось удалить сообщение для всех.",
      );
    }
  }

  async function handleToggleEncryptedGroupPin(messageId: string, pinned: boolean) {
    if (selectedState.status !== "ready") {
      return;
    }

    setEncryptedComposerError(null);
    setActionError(null);
    setNotice(null);

    try {
      if (pinned) {
        await gatewayClient.unpinEncryptedGroupMessage(
          token,
          selectedState.snapshot.group.id,
          messageId,
        );
      } else {
        await gatewayClient.pinEncryptedGroupMessage(
          token,
          selectedState.snapshot.group.id,
          messageId,
        );
      }
      await reloadSelectedGroup(selectedState.snapshot.group.id, true);
      await reloadGroups();
    } catch (error) {
      const message = resolveProtectedError(
        error,
        pinned
          ? "Не удалось снять закрепление."
          : "Не удалось закрепить сообщение.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    }
  }

  async function handleEncryptedAttachmentSelection(file: File | null) {
    if (file === null) {
      return;
    }

    setEncryptedComposerError(null);
    setActionError(null);
    setNotice(null);
    await encryptedMediaAttachmentDraft.selectFile(file);
  }

  async function handleEncryptedGroupMediaNoteSend(
    file: File | null,
    clearRecorderDraft: () => void,
  ) {
    if (selectedState.status !== "ready" || file === null) {
      return;
    }

    setEncryptedComposerError(null);
    setActionError(null);
    setNotice(null);

    try {
      const uploadedDraft = await encryptedMediaAttachmentDraft.selectFile(file);
      if (uploadedDraft === null) {
        return;
      }

      const result = await cryptoRuntime.sendEncryptedGroupContent(
        selectedState.snapshot.group.id,
        "",
        selectedEncryptedReplyEntry?.messageId ?? null,
        [uploadedDraft],
      );
      if (result === null) {
        return;
      }

      publishLocalEncryptedGroupProjection(result.localProjection);
      setSelectedEncryptedReplyMessageId(null);
      encryptedMediaAttachmentDraft.markSendSucceeded();
      clearRecorderDraft();
      setNotice("Media note отправлена.");
    } catch (error) {
      encryptedMediaAttachmentDraft.markSendFailed();
      setEncryptedComposerError(
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : "Не удалось отправить media note.",
      );
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
      const inviteLinksPromise = snapshot.group.permissions.canManageInviteLinks
        ? gatewayClient.listGroupInviteLinks(token, groupId)
        : Promise.resolve([]);
      const [members, inviteLinks] = await Promise.all([
        membersPromise,
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
        messages: [],
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
    if (desktopShellHost !== null) {
      const group = groups.find((entry) => entry.id === groupId) ?? null;
      desktopShellHost.openGroupChat({
        groupId,
        title: group?.name ?? "Группа",
      });
      return;
    }

    const params = new URLSearchParams();
    params.set("group", groupId);
    setSearchParams(params, { replace: true });
  }

  function clearGroupSelection() {
    if (desktopShellHost !== null) {
      desktopShellHost.launchApp("groups");
      return;
    }

    setSearchParams(new URLSearchParams(), { replace: true });
  }

  function setGroupInfoMode(nextMode: "thread" | "info") {
    if (desktopShellHost !== null) {
      desktopShellHost.setActiveWindowContentMode(nextMode);
      return;
    }

    setMobileWindowContentMode(nextMode);
  }

  return (
    <div
      className={`${styles.layout} ${isDesktopTargetWindow ? styles.desktopWindowLayout : ""}`}
    >
      {!isDesktopTargetWindow && (
        <section className={styles.heroCard}>
        <div className={styles.heroHeader}>
          <div>
            <p className={styles.cardLabel}>Groups</p>
            <h1 className={styles.title}>Группы AeroChat</h1>
            <p className={styles.subtitle}>
              Окно группы показывает обычную переписку, вложения и действия участников. Звонки
              по-прежнему остаются отдельной компактной lobby-поверхностью.
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
          <Metric label="Новых" value={selectedState.status === "ready" ? selectedState.snapshot.group.encryptedUnreadCount : 0} />
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
      )}

      <div
        className={`${styles.workspace} ${isDesktopTargetWindow ? styles.desktopWindowWorkspace : ""}`}
      >
        {!isDesktopTargetWindow && (
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
                {groups.map((group) => {
                  const activeGroupCallEntry =
                    groupCallAwarenessState.activeCallsByGroupId[group.id] ?? null;

                  return (
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
                            {group.encryptedUnreadCount > 0 && (
                              <span className={styles.unreadPill}>
                                Новых: {group.encryptedUnreadCount}
                              </span>
                            )}
                            {activeGroupCallEntry && (
                              <span className={styles.callPill}>
                                Звонок активен · {activeGroupCallEntry.call.activeParticipantCount}
                              </span>
                            )}
                            <span className={styles.rolePill}>{roleLabel(group.selfRole)}</span>
                          </div>
                        </div>
                      </article>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
          </aside>
        )}

        <section
          className={`${styles.mainColumn} ${isDesktopTargetWindow ? styles.desktopMainColumn : ""}`}
        >
          {isDesktopTargetWindow && notice && <div className={styles.notice}>{notice}</div>}
          {isDesktopTargetWindow && searchJumpNotice && (
            <div className={styles.notice}>{searchJumpNotice}</div>
          )}
          {isDesktopTargetWindow && actionError && <div className={styles.error}>{actionError}</div>}

          {selectedState.status === "idle" && (
            <InlineState
              title="Группа не выбрана"
              message="Откройте группу из списка слева или используйте explicit join по invite link."
            />
          )}

          {selectedState.status === "loading" && (
            <InlineState
              title="Открываем группу"
              message="Загружаем группу, участников и текущую переписку."
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
                  {groupWindowContentMode === "thread" ? (
                    <button
                      className={styles.groupIdentityButton}
                      onClick={() => {
                        setGroupInfoMode("info");
                      }}
                      type="button"
                    >
                      <p className={styles.cardLabel}>Group shell</p>
                      <h2 className={styles.panelTitle}>{selectedState.snapshot.group.name}</h2>
                      <p className={styles.description}>
                        Текущая роль: {roleLabel(selectedState.snapshot.group.selfRole)}. Thread
                        key: `{selectedState.snapshot.thread.threadKey}`.
                      </p>
                      <p className={styles.infoActionHint}>
                        Открыть участников, роли, invite links и действия группы в этом же окне
                      </p>
                    </button>
                  ) : (
                    <div>
                      <p className={styles.cardLabel}>Group info</p>
                      <h2 className={styles.panelTitle}>{selectedState.snapshot.group.name}</h2>
                      <p className={styles.description}>
                        Управление группой остаётся в том же canonical window без нового target.
                        Текущая роль: {roleLabel(selectedState.snapshot.group.selfRole)}.
                      </p>
                    </div>
                  )}

                  <div className={styles.badgeColumn}>
                    {groupWindowContentMode === "info" && (
                      <button
                        className={styles.secondaryButton}
                        onClick={() => {
                          setGroupInfoMode("thread");
                        }}
                        type="button"
                      >
                        Назад к переписке
                      </button>
                    )}
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

              {groupWindowContentMode === "thread" && (
                <>
              <section className={styles.panelCard}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.cardLabel}>Group call</p>
                    <h2 className={styles.panelTitle}>Лобби звонка</h2>
                  </div>
                  <div className={styles.badgeColumn}>
                    <span className={styles.statusPill}>
                      {describeGroupCallPhaseLabel(selectedGroupCallPhase)}
                    </span>
                    {selectedGroupCallEntry && (
                      <span className={styles.statusPill}>
                        Active participants: {selectedGroupCallParticipants.length}
                      </span>
                    )}
                  </div>
                </div>

                <p className={styles.description}>
                  Surface честно остаётся group call lobby: можно увидеть активный server-backed
                  call, стартовать, войти, выйти и завершить его по текущей policy. Multi-party
                  browser audio/video transport пока не реализован.
                </p>

                {selectedGroupCallEntry && (
                  <div className={styles.timelineMeta}>
                    <span className={styles.statusPill}>
                      Control-plane:{" "}
                      {selectedGroupCallEntry.call.status === "active" ? "active" : "ended"}
                    </span>
                    <span className={styles.statusPill}>
                      {selectedGroupCallSelfParticipant !== null
                        ? "Вы в lobby"
                        : selectedGroupCallActions?.isReadOnly
                          ? "Наблюдение"
                          : "Наблюдение без join"}
                    </span>
                    <span className={styles.statusPill}>
                      Создатель:{" "}
                      {selectedGroupCallEntry.call.createdByUserId === authState.profile.id
                        ? "вы"
                        : "другой участник"}
                    </span>
                  </div>
                )}

                {groupCallError && (
                  <div className={styles.error}>
                    <div className={styles.inlineActionRow}>
                      <span>{groupCallError}</span>
                      <button
                        className={styles.ghostButton}
                        onClick={() => {
                          setGroupCallError(null);
                          setGroupCallTerminalState("idle");
                        }}
                        type="button"
                      >
                        Скрыть
                      </button>
                    </div>
                  </div>
                )}

                {selectedGroupCallEntry === null && (
                  <>
                    <div className={styles.notice}>
                      В этой группе сейчас нет активного звонка. Новый call создаётся через
                      существующий `StartCall`, а UI дальше сходится только от server-backed
                      refresh.
                    </div>

                    {selectedGroupCallActions?.isReadOnly ? (
                      <div className={styles.readOnlyNotice}>
                        Роль `reader` может видеть будущий active group call и roster участников,
                        но не может запускать, join'ить или завершать звонок.
                      </div>
                    ) : (
                      <div className={styles.actions}>
                        <button
                          className={styles.primaryButton}
                          disabled={selectedGroupCallActions?.canStart !== true}
                          onClick={() => {
                            void handleStartGroupCall();
                          }}
                          type="button"
                        >
                          {groupCallActionState === "starting"
                            ? "Запускаем..."
                            : "Начать звонок"}
                        </button>
                      </div>
                    )}
                  </>
                )}

                {selectedGroupCallEntry !== null && (
                  <>
                    {selectedGroupCallActions?.isReadOnly && (
                      <div className={styles.readOnlyNotice}>
                        `reader` остаётся observe-only участником: active call и roster видны, но
                        join/start/end заблокированы текущей серверной policy.
                      </div>
                    )}

                    <div className={styles.actions}>
                      {selectedGroupCallActions?.canJoin && (
                        <button
                          className={styles.primaryButton}
                          disabled={groupCallActionState !== "idle"}
                          onClick={() => {
                            void handleJoinGroupCall();
                          }}
                          type="button"
                        >
                          {groupCallActionState === "joining"
                            ? "Входим..."
                            : "Присоединиться"}
                        </button>
                      )}

                      {selectedGroupCallActions?.canLeave && (
                        <button
                          className={styles.secondaryButton}
                          disabled={groupCallActionState !== "idle"}
                          onClick={() => {
                            void handleLeaveGroupCall();
                          }}
                          type="button"
                        >
                          {groupCallActionState === "leaving"
                            ? "Выходим..."
                            : "Покинуть lobby"}
                        </button>
                      )}

                      {selectedGroupCallActions?.canEnd && (
                        <button
                          className={styles.dangerButton}
                          disabled={groupCallActionState !== "idle"}
                          onClick={() => {
                            void handleEndGroupCall();
                          }}
                          type="button"
                        >
                          {groupCallActionState === "ending"
                            ? "Завершаем..."
                            : "Завершить звонок"}
                        </button>
                      )}
                    </div>

                    <div className={styles.rosterCard}>
                      <div className={styles.blockHeader}>
                        <div>
                          <p className={styles.cardLabel}>Participants</p>
                          <h3 className={styles.blockTitle}>Активные участники lobby</h3>
                        </div>
                        <span className={styles.metaTag}>
                          {selectedGroupCallParticipants.length}
                        </span>
                      </div>

                      {selectedGroupCallParticipants.length === 0 ? (
                        <p className={styles.emptyState}>
                          Серверный call активен, но roster ещё пустой. Следующий refresh уточнит
                          active participants.
                        </p>
                      ) : (
                        <div className={styles.rosterList}>
                          {selectedGroupCallParticipants.map((participant) => {
                            const participantMember =
                              selectedState.members.find(
                                (member) => member.user.id === participant.userId,
                              ) ?? null;

                            return (
                              <article
                                className={styles.rosterItem}
                                key={participant.id}
                              >
                                <div>
                                  <p className={styles.rosterName}>
                                    {describeGroupCallParticipantName(
                                      participant,
                                      participantMember,
                                      authState.profile.id,
                                    )}
                                  </p>
                                  <p className={styles.rosterMeta}>
                                    joined {formatDateTime(participant.joinedAt)}
                                  </p>
                                </div>
                                <div className={styles.badgeColumn}>
                                  {participantMember && (
                                    <span className={styles.rolePill}>
                                      {roleLabel(participantMember.role)}
                                    </span>
                                  )}
                                  <span className={styles.statusPill}>active</span>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>

              <section className={styles.panelCard}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.cardLabel}>Сообщения</p>
                    <h2 className={styles.panelTitle}>Переписка группы</h2>
                  </div>
                  <p className={styles.panelCopy}>
                    Сообщения и вложения открываются как обычная переписка. Если часть истории
                    недоступна, это показывается отдельным состоянием ниже.
                  </p>
                </div>

                {selectedState.snapshot.group.encryptedUnreadCount > 0 && (
                  <div className={styles.timelineMeta}>
                    <span className={styles.statusPill}>
                      Новых сообщений {selectedState.snapshot.group.encryptedUnreadCount}
                    </span>
                  </div>
                )}

                {encryptedGroupLane.status === "loading" && (
                  <InlineState
                    title="Загружаем сообщения"
                    message="Подготавливаем переписку группы для чтения."
                  />
                )}

                {encryptedGroupLane.status === "unavailable" && (
                  <InlineState
                    title="Сообщения недоступны"
                    message={
                      encryptedGroupLane.errorMessage ??
                      "Для этой группы не удалось подготовить переписку."
                    }
                  />
                )}

                {encryptedGroupLane.status === "error" && (
                  <InlineState
                    title="Не удалось загрузить сообщения"
                    message={
                      encryptedGroupLane.errorMessage ??
                      "Не удалось подготовить переписку группы."
                    }
                    tone="error"
                  />
                )}

                {encryptedGroupLane.status === "ready" && (
                  <>
                    {!selectedState.snapshot.thread.canSendMessages && (
                      <div className={styles.readOnlyNotice}>
                        {selectedSelfMember?.isWriteRestricted
                          ? "Сейчас для этого участника отправка сообщений отключена."
                          : "Текущая роль позволяет только читать переписку."}
                      </div>
                    )}

                    {selectedState.snapshot.group.encryptedPinnedMessageIds.length > 0 && (
                      <div className={styles.messagesList}>
                        {encryptedPinnedMessages.map(({ messageId, entry }) => (
                          <article className={styles.messageCard} key={messageId}>
                            <div className={styles.messageHeader}>
                              <div>
                                <p className={styles.messageAuthor}>
                                  {entry === null
                                    ? "Сообщение"
                                    : describeEncryptedGroupAuthor(
                                        entry,
                                        authState.profile.id,
                                        selectedState.members,
                                      )}
                                </p>
                                <p className={styles.messageMeta}>
                                  {entry === null
                                    ? "Локально не разрешено"
                                    : formatDateTime(entry.createdAt)}
                                </p>
                              </div>
                              <div className={styles.badgeColumn}>
                                <span className={styles.statusPill}>Закреплено</span>
                              </div>
                            </div>
                            <div className={styles.messageBody}>
                              <p className={styles.helperText}>
                                {describeEncryptedGroupPinnedPreview(entry)}
                              </p>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}

                    <form
                      className={styles.composer}
                      onSubmit={handleSendEncryptedGroupMessage}
                    >
                      {selectedEncryptedReplyEntry && (
                        <div className={styles.replyComposerCard}>
                          <div>
                            <p className={styles.replyPreviewAuthor}>
                              Ответ на{" "}
                              {describeEncryptedGroupAuthor(
                                selectedEncryptedReplyEntry,
                                authState.profile.id,
                                selectedState.members,
                              )}
                            </p>
                            <p className={styles.replyPreviewText}>
                              {describeEncryptedGroupComposerReplyTarget(
                                selectedEncryptedReplyEntry,
                              )}
                            </p>
                          </div>
                          <button
                            className={styles.ghostButton}
                            onClick={() => {
                              setSelectedEncryptedReplyMessageId(null);
                            }}
                            type="button"
                          >
                            Отменить ответ
                          </button>
                        </div>
                      )}

                      {editingEncryptedEntry && (
                        <div className={styles.replyComposerCard}>
                          <div>
                            <p className={styles.replyPreviewAuthor}>
                              Редактирование · версия {editingEncryptedEntry.revision + 1}
                            </p>
                            <p className={styles.replyPreviewText}>
                              {describeEncryptedGroupComposerReplyTarget(editingEncryptedEntry)}
                            </p>
                          </div>
                          <button
                            className={styles.ghostButton}
                            onClick={() => {
                              setEditingEncryptedMessageId(null);
                              setSelectedEncryptedReplyMessageId(null);
                              setEncryptedComposerText("");
                            }}
                            type="button"
                          >
                            Отменить редактирование
                          </button>
                        </div>
                      )}

                      <div className={styles.attachmentActions}>
                        <input
                          accept="*/*"
                          className={styles.attachmentInput}
                          onChange={(event) => {
                            const file = event.target.files?.[0] ?? null;
                            void handleEncryptedAttachmentSelection(file);
                            event.target.value = "";
                          }}
                          ref={encryptedAttachmentInputRef}
                          type="file"
                        />
                        <button
                          className={styles.secondaryButton}
                          disabled={!canPickEncryptedAttachment}
                          onClick={() => {
                            encryptedAttachmentInputRef.current?.click();
                          }}
                          type="button"
                        >
                          {encryptedAttachmentDraft === null
                            ? "Добавить файл"
                            : "Заменить файл"}
                        </button>
                        <span className={styles.attachmentHint}>
                          Прикрепите файл вручную или используйте voice/video note ниже. Всё
                          уходит через тот же encrypted attachment flow.
                        </span>
                      </div>

                      <VoiceNoteRecorderPanel
                        state={voiceNoteRecorder.state}
                        startDisabled={voiceNoteStartDisabled}
                        stopDisabled={voiceNoteRecorder.state.status !== "recording"}
                        discardDisabled={!canUseEncryptedMediaNoteEntry}
                        sendDisabled={
                          !canUseEncryptedMediaNoteEntry ||
                          voiceNoteRecorder.state.draft === null
                        }
                        isSending={
                          encryptedMediaAttachmentDraft.isUploading ||
                          cryptoRuntime.state.isActionPending
                        }
                        onStart={() => {
                          void voiceNoteRecorder.startRecording();
                        }}
                        onStop={() => {
                          voiceNoteRecorder.stopRecording();
                        }}
                        onDiscard={() => {
                          voiceNoteRecorder.discardRecording();
                        }}
                        onSend={() => {
                          void handleEncryptedGroupMediaNoteSend(
                            voiceNoteRecorder.state.draft?.file ?? null,
                            () => {
                              voiceNoteRecorder.discardRecording();
                            },
                          );
                        }}
                      />

                      <VideoNoteRecorderPanel
                        state={videoNoteRecorder.state}
                        startDisabled={videoNoteStartDisabled}
                        stopDisabled={videoNoteRecorder.state.status !== "recording"}
                        discardDisabled={!canUseEncryptedMediaNoteEntry}
                        sendDisabled={
                          !canUseEncryptedMediaNoteEntry ||
                          videoNoteRecorder.state.draft === null
                        }
                        isSending={
                          encryptedMediaAttachmentDraft.isUploading ||
                          cryptoRuntime.state.isActionPending
                        }
                        onStart={() => {
                          void videoNoteRecorder.startRecording();
                        }}
                        onStop={() => {
                          videoNoteRecorder.stopRecording();
                        }}
                        onDiscard={() => {
                          videoNoteRecorder.discardRecording();
                        }}
                        onSend={() => {
                          void handleEncryptedGroupMediaNoteSend(
                            videoNoteRecorder.state.draft?.file ?? null,
                            () => {
                              videoNoteRecorder.discardRecording();
                            },
                          );
                        }}
                      />

                      {encryptedAttachmentDraft && (
                        <div className={styles.attachmentDraftCard}>
                          <div>
                            <p className={styles.attachmentDraftTitle}>
                              {encryptedAttachmentDraft.fileName}
                            </p>
                            <p className={styles.attachmentDraftMeta}>
                              {formatAttachmentSize(
                                encryptedAttachmentDraft.plaintextSizeBytes,
                              )}
                              {encryptedAttachmentDraft.ciphertextSizeBytes > 0 &&
                                ` • ${formatAttachmentSize(
                                  encryptedAttachmentDraft.ciphertextSizeBytes,
                                )} после подготовки`}
                              {" • "}
                              {describeAttachmentMimeType(encryptedAttachmentDraft.mimeType)}
                            </p>
                            {encryptedAttachmentDraft.status === "preparing" && (
                              <p className={styles.attachmentDraftStatus}>
                                Подготавливаем файл...
                              </p>
                            )}
                            {encryptedAttachmentDraft.status === "uploading" && (
                              <p className={styles.attachmentDraftStatus}>
                                Загружаем файл: {encryptedAttachmentDraft.progress}%
                              </p>
                            )}
                            {encryptedAttachmentDraft.status === "uploaded" && (
                              <p className={styles.attachmentDraftStatus}>
                                Файл готов к отправке.
                              </p>
                            )}
                            {encryptedAttachmentDraft.status === "error" && (
                              <p className={styles.attachmentDraftError}>
                                {encryptedAttachmentDraft.errorMessage}
                              </p>
                            )}
                          </div>

                          <div className={styles.attachmentDraftActions}>
                            {encryptedAttachmentDraft.status === "error" && (
                              <button
                                className={styles.ghostButton}
                                onClick={() => {
                                  void encryptedMediaAttachmentDraft.retryUpload();
                                }}
                                type="button"
                              >
                                Повторить upload
                              </button>
                            )}
                            <button
                              className={styles.ghostButton}
                              onClick={() => {
                                encryptedMediaAttachmentDraft.removeDraft();
                              }}
                              type="button"
                            >
                              Убрать
                            </button>
                          </div>
                        </div>
                      )}

                      <label className={styles.field}>
                        <span>Сообщение</span>
                        <textarea
                          disabled={
                            cryptoRuntime.state.isActionPending ||
                            encryptedMediaAttachmentDraft.isUploading ||
                            !selectedState.snapshot.thread.canSendMessages
                          }
                          maxLength={4000}
                          onChange={(event) => {
                            setEncryptedComposerText(event.target.value);
                            setEncryptedComposerError(null);
                          }}
                          placeholder={
                            selectedState.snapshot.thread.canSendMessages
                              ? "Напишите сообщение"
                              : "Текущая роль не может отправлять сообщения"
                          }
                          rows={4}
                          value={encryptedComposerText}
                        />
                      </label>

                      {encryptedComposerError && (
                        <div className={styles.error}>{encryptedComposerError}</div>
                      )}

                      <p className={styles.helperText}>{encryptedSendHint}</p>

                      <div className={styles.composerFooter}>
                        <span className={styles.characterCount}>
                          {normalizeComposerMessageText(encryptedComposerText).length}/4000
                        </span>
                        <button
                          className={styles.primaryButton}
                          disabled={!canSendEncryptedGroupText}
                          type="submit"
                        >
                          {cryptoRuntime.state.isActionPending
                            ? "Собираем..."
                            : editingEncryptedEntry !== null
                              ? "Сохранить правки"
                              : "Отправить"}
                        </button>
                      </div>
                    </form>

                    <div className={styles.messagesList}>
                      {encryptedThreadMessages.length === 0 ? (
                        <InlineState
                          title="Сообщений пока нет"
                          message="В этом окне ещё нет доступных сообщений."
                        />
                      ) : (
                        encryptedThreadMessages.map((entry) => (
                          <article
                            className={styles.messageCard}
                            data-own={
                              entry.senderUserId === authState.profile.id ? "true" : undefined
                            }
                            id={
                              entry.kind === "message"
                                ? `encrypted-group-message-${entry.messageId}`
                                : undefined
                            }
                            key={entry.key}
                          >
                            <div className={styles.messageHeader}>
                              <div>
                                <p className={styles.messageAuthor}>
                                  {describeEncryptedGroupAuthor(
                                    entry,
                                    authState.profile.id,
                                    selectedState.members,
                                  )}
                                </p>
                                <p className={styles.messageMeta}>
                                  {formatDateTime(entry.createdAt)}
                                </p>
                              </div>
                              <div className={styles.badgeColumn}>
                                {entry.kind === "message" &&
                                  selectedState.snapshot.group.encryptedPinnedMessageIds.includes(
                                    entry.messageId,
                                  ) && <span className={styles.statusPill}>pin</span>}
                                <span className={styles.statusPill}>
                                  {entry.kind === "message"
                                    ? entry.isTombstone
                                      ? "tombstone"
                                      : entry.editedAt
                                        ? "edited"
                                        : "content"
                                    : "decrypt failed"}
                                </span>
                              </div>
                            </div>

                            <div className={styles.messageBody}>
                              {entry.kind === "message" ? (
                                entry.isTombstone ? (
                                  <p className={styles.helperText}>
                                    Сообщение скрыто после удаления для всех.
                                  </p>
                                ) : (
                                  <>
                                    {resolveEncryptedGroupReplyTarget(
                                      encryptedMessageIndex,
                                      entry.replyToMessageId,
                                      authState.profile.id,
                                      selectedState.members,
                                    ) && (
                                      <button
                                        className={styles.replyPreviewCard}
                                        disabled={
                                          resolveEncryptedGroupReplyTarget(
                                            encryptedMessageIndex,
                                            entry.replyToMessageId,
                                            authState.profile.id,
                                            selectedState.members,
                                          )?.messageId === null
                                        }
                                        onClick={() => {
                                          const target = resolveEncryptedGroupReplyTarget(
                                            encryptedMessageIndex,
                                            entry.replyToMessageId,
                                            authState.profile.id,
                                            selectedState.members,
                                          );
                                          if (target !== null && target.messageId !== null) {
                                            jumpToMessage(
                                              `encrypted-group-message-${target.messageId}`,
                                            );
                                          }
                                        }}
                                        type="button"
                                      >
                                        <span className={styles.replyPreviewAuthor}>
                                          {resolveEncryptedGroupReplyTarget(
                                            encryptedMessageIndex,
                                            entry.replyToMessageId,
                                            authState.profile.id,
                                            selectedState.members,
                                          )?.authorLabel ?? "Ответ"}
                                        </span>
                                        <span className={styles.replyPreviewText}>
                                          {resolveEncryptedGroupReplyTarget(
                                            encryptedMessageIndex,
                                            entry.replyToMessageId,
                                            authState.profile.id,
                                            selectedState.members,
                                          )?.previewText ?? ""}
                                        </span>
                                      </button>
                                    )}
                                    {entry.text && entry.text.trim() !== "" ? (
                                      <div className={styles.messageText}>
                                        <SafeMessageMarkdown text={entry.text} />
                                      </div>
                                    ) : entry.attachments.length === 0 ? (
                                      <p className={styles.helperText}>
                                        В сообщении нет доступного текста.
                                      </p>
                                    ) : null}
                                    <EncryptedMessageAttachmentList
                                      accessToken={token}
                                      attachments={entry.attachments}
                                      tone={
                                        entry.senderUserId === authState.profile.id
                                          ? "own"
                                          : "other"
                                      }
                                    />
                                  </>
                                )
                              ) : (
                                <div className={styles.error}>
                                  {describeEncryptedGroupLaneIssue(entry)}
                                </div>
                              )}
                            </div>

                            {entry.kind === "message" && !entry.isTombstone && (
                              <div className={styles.actions}>
                                <button
                                  className={styles.secondaryButton}
                                  onClick={() => {
                                    setSelectedEncryptedReplyMessageId(entry.messageId);
                                    setEditingEncryptedMessageId(null);
                                    setEncryptedComposerError(null);
                                    setActionError(null);
                                    setNotice(null);
                                  }}
                                  type="button"
                                >
                                  Ответить
                                </button>
                                {entry.senderUserId === authState.profile.id && (
                                  <button
                                    className={styles.secondaryButton}
                                    onClick={() => {
                                      setEditingEncryptedMessageId(entry.messageId);
                                      setSelectedEncryptedReplyMessageId(entry.replyToMessageId);
                                      setEncryptedComposerText(entry.text ?? "");
                                      setEncryptedComposerError(null);
                                      setActionError(null);
                                      setNotice(null);
                                    }}
                                    type="button"
                                  >
                                    Редактировать
                                  </button>
                                )}
                                <button
                                  className={styles.secondaryButton}
                                  onClick={() => {
                                    void handleToggleEncryptedGroupPin(
                                      entry.messageId,
                                      selectedState.snapshot.group.encryptedPinnedMessageIds.includes(
                                        entry.messageId,
                                      ),
                                    );
                                  }}
                                  type="button"
                                >
                                  {selectedState.snapshot.group.encryptedPinnedMessageIds.includes(
                                    entry.messageId,
                                  )
                                    ? "Снять закрепление"
                                    : "Закрепить"}
                                </button>
                                {entry.senderUserId === authState.profile.id && (
                                  <button
                                    className={styles.secondaryButton}
                                    onClick={() => {
                                      void handleDeleteEncryptedGroupMessage(entry);
                                    }}
                                    type="button"
                                  >
                                    Удалить для всех
                                  </button>
                                )}
                              </div>
                            )}

                            <p className={styles.editMeta}>
                              сохранено {formatDateTime(entry.storedAt)}
                              {entry.kind === "message" && entry.editedAt
                                ? ` • изменено ${formatDateTime(entry.editedAt)}`
                                : ""}
                              {entry.kind === "message" && entry.deletedAt
                                ? ` • удалено ${formatDateTime(entry.deletedAt)}`
                                : ""}
                            </p>
                          </article>
                        ))
                      )}
                    </div>
                  </>
                )}
              </section>

              <section className={styles.panelCard}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.cardLabel}>История</p>
                    <h2 className={styles.panelTitle}>Ранние сообщения недоступны</h2>
                  </div>
                  <p className={styles.panelCopy}>
                    В этом окне доступны текущие сообщения. Более ранняя история здесь сейчас не
                    открывается.
                  </p>
                </div>

                <div className={styles.timelineMeta}>
                  <span className={styles.statusPill}>Недоступно</span>
                  <span className={styles.statusPill}>
                    Обновлено {formatDateTime(selectedState.snapshot.thread.updatedAt)}
                  </span>
                  {typingLabel && <span className={styles.statusPill}>{typingLabel}</span>}
                </div>

                <div className={styles.messagesList}>
                  <InlineState
                    title="История недоступна"
                    message="Текущая группа работает через обычное окно переписки без отдельного fallback-режима для старого пути."
                  />
                </div>
              </section>
                </>
              )}

              {groupWindowContentMode === "info" && (
                <>
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
            </>
          )}
        </section>
      </div>
    </div>
  );

}

function describeEncryptedGroupAuthor(
  entry: EncryptedGroupProjectionEntry,
  currentUserId: string,
  members: GroupMember[],
): string {
  if (entry.senderUserId === currentUserId) {
    return "Вы";
  }

  const member = members.find((candidate) => candidate.user.id === entry.senderUserId);
  if (!member) {
    return "Участник группы";
  }

  return member.user.nickname || `@${member.user.login}`;
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

function describeGroupCallPhaseLabel(phase: ReturnType<typeof deriveGroupCallUiPhase>): string {
  switch (phase) {
    case "starting":
      return "starting";
    case "joined":
      return "joined";
    case "observing":
      return "observing";
    case "ending":
      return "ending";
    case "ended":
      return "ended";
    case "failed":
      return "failed";
    case "active":
      return "active";
    case "no_active_call":
    default:
      return "no active call";
  }
}

function sortGroupCallParticipants(
  participants: RtcCallParticipant[],
  members: GroupMember[],
  currentUserId: string,
): RtcCallParticipant[] {
  const membersByUserId = new Map(members.map((member) => [member.user.id, member] as const));

  return [...participants].sort((left, right) => {
    const leftMember = membersByUserId.get(left.userId) ?? null;
    const rightMember = membersByUserId.get(right.userId) ?? null;
    const leftName = describeGroupCallParticipantName(left, leftMember, currentUserId);
    const rightName = describeGroupCallParticipantName(right, rightMember, currentUserId);
    const joinedCompare = left.joinedAt.localeCompare(right.joinedAt);
    if (joinedCompare !== 0) {
      return joinedCompare;
    }

    const nameCompare = leftName.localeCompare(rightName, "ru");
    if (nameCompare !== 0) {
      return nameCompare;
    }

    return left.id.localeCompare(right.id);
  });
}

function describeGroupCallParticipantName(
  participant: RtcCallParticipant,
  member: GroupMember | null,
  currentUserId: string,
): string {
  if (participant.userId === currentUserId) {
    return "Вы";
  }

  if (member === null) {
    return "Участник группы";
  }

  return member.user.nickname || `@${member.user.login}`;
}

interface EncryptedGroupReplyTargetDescriptor {
  messageId: string | null;
  authorLabel: string;
  previewText: string;
}

function resolveEncryptedGroupReplyTarget(
  entries: Map<string, EncryptedGroupProjectedMessageEntry>,
  messageId: string | null,
  currentUserId: string,
  members: GroupMember[],
): EncryptedGroupReplyTargetDescriptor | null {
  if (messageId === null) {
    return null;
  }

  const target = entries.get(messageId);
  if (target === undefined) {
    return {
      messageId: null,
      authorLabel: "Недоступное сообщение",
      previewText: "Исходное сообщение пока недоступно в этом окне.",
    };
  }

  if (target.isTombstone) {
    return {
      messageId: target.messageId,
      authorLabel: "Удалённое сообщение",
      previewText: "Сообщение удалено для всех.",
    };
  }

  return {
    messageId: target.messageId,
    authorLabel: describeEncryptedGroupAuthor(target, currentUserId, members),
    previewText: describeEncryptedGroupComposerReplyTarget(target),
  };
}

function describeEncryptedGroupComposerReplyTarget(
  entry: EncryptedGroupProjectedMessageEntry,
): string {
  if (entry.isTombstone) {
    return "Сообщение удалено для всех.";
  }
  if (entry.text && entry.text.trim() !== "") {
    return entry.text.length > 140 ? `${entry.text.slice(0, 137)}...` : entry.text;
  }
  if (entry.attachments.length > 0) {
    return entry.attachments.length === 1
      ? "Вложение"
      : `Вложения: ${entry.attachments.length}`;
  }

  return "Сообщение без доступного содержимого.";
}

function describeEncryptedGroupPinnedPreview(
  entry: EncryptedGroupProjectedMessageEntry | null,
): string {
  if (entry === null) {
    return "Сообщение закреплено, но его содержимое пока недоступно в этом окне.";
  }
  if (entry.isTombstone) {
    return "Сообщение закреплено, но уже удалено для всех.";
  }

  return describeEncryptedGroupComposerReplyTarget(entry);
}

function describeEncryptedGroupBootstrapSendHint(input: {
  groupSelected: boolean;
  composerText: string;
  encryptedAttachmentDraft: ReturnType<
    typeof useEncryptedMediaAttachmentDraft
  >["draft"];
  isEditingEncryptedMessage: boolean;
  hasEncryptedReplyTarget: boolean;
  cryptoRuntimeState: CryptoContextState;
}): string {
  if (!input.groupSelected) {
    return "Откройте группу, чтобы отправить сообщение.";
  }
  if (input.cryptoRuntimeState.status !== "ready") {
    return "Подготавливаем защищённый режим отправки.";
  }
  const snapshot = input.cryptoRuntimeState.snapshot;
  if (
    snapshot === null ||
    snapshot.support !== "available" ||
    snapshot.phase === "error" ||
    snapshot.localDevice?.status !== "active"
  ) {
    return (
      snapshot?.errorMessage ??
      "Для отправки сообщений нужно активное локальное устройство."
    );
  }
  if (input.encryptedAttachmentDraft?.status === "preparing") {
    return "Подготавливаем файл перед загрузкой.";
  }
  if (input.encryptedAttachmentDraft?.status === "uploading") {
    return "Загружаем файл и готовим его к отправке.";
  }
  if (input.encryptedAttachmentDraft?.status === "error") {
    return "Не удалось подготовить файл. Исправьте ошибку и повторите.";
  }
  if (input.isEditingEncryptedMessage) {
    return "Следующее действие сохранит изменения сообщения.";
  }
  if (input.hasEncryptedReplyTarget) {
    return "Следующее сообщение будет отправлено как ответ.";
  }
  if (
    normalizeComposerMessageText(input.composerText) === "" &&
    input.encryptedAttachmentDraft?.status !== "uploaded"
  ) {
    return "Введите текст или подготовьте файл для отправки.";
  }
  if (input.encryptedAttachmentDraft?.status === "uploaded") {
    return "Файл готов. Можно отправлять сообщение.";
  }

  return "Сообщение будет отправлено обычным действием из этого окна.";
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
