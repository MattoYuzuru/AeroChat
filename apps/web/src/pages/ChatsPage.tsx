import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  normalizeComposerMessageText,
} from "../attachments/message-content";
import { describeAttachmentMimeType, formatAttachmentSize } from "../attachments/metadata";
import { VideoNoteRecorderPanel } from "../attachments/VideoNoteRecorderPanel";
import { VoiceNoteRecorderPanel } from "../attachments/VoiceNoteRecorderPanel";
import { useVideoNoteRecorder } from "../attachments/useVideoNoteRecorder";
import { useVoiceNoteRecorder } from "../attachments/useVoiceNoteRecorder";
import { useAuth } from "../auth/useAuth";
import {
  describeEncryptedDirectMessageV2Failure,
  type EncryptedDirectMessageV2ProjectionEntry,
  type EncryptedDirectMessageV2ProjectedMessageEntry,
} from "../chats/encrypted-v2-projection";
import { EncryptedMessageAttachmentList } from "../chats/EncryptedMessageAttachmentList";
import { publishLocalEncryptedDirectMessageV2Projection } from "../chats/encrypted-v2-local-outbound";
import { resolveChatsRouteSyncAction } from "../chats/route-sync";
import { SafeMessageMarkdown } from "../chats/SafeMessageMarkdown";
import { useEncryptedMediaAttachmentDraft } from "../chats/useEncryptedMediaAttachmentDraft";
import {
  describeEncryptedDirectMessageV2LaneEmptyState,
  useEncryptedDirectMessageV2Lane,
} from "../chats/useEncryptedDirectMessageV2Lane";
import type { CryptoContextState } from "../crypto/runtime-context";
import { useCryptoRuntime } from "../crypto/useCryptoRuntime";
import { useChats } from "../chats/useChats";
import { gatewayClient } from "../gateway/runtime";
import {
  describeGatewayError,
  isGatewayErrorCode,
  type ChatUser,
  type DirectChat,
  type DirectChatPresenceState,
  type DirectChatReadState,
  type DirectChatTypingState,
  type EncryptedDirectChatReadState,
  type Profile,
} from "../gateway/types";
import { usePeople } from "../people/usePeople";
import {
  clearSearchJumpParams,
  findJumpTarget,
  readSearchJumpIntent,
} from "../search/jump";
import { primeEncryptedDirectLocalSearchIndex } from "../search/encrypted-local-search";
import { useDirectCallAwareness } from "../rtc/useDirectCallAwareness";
import { useDirectCallSession } from "../rtc/useDirectCallSession";
import { useDesktopShellHost } from "../shell/context";
import styles from "./ChatsPage.module.css";

export function ChatsPage() {
  const { state: authState, expireSession } = useAuth();
  const desktopShellHost = useDesktopShellHost();
  const directCallAwareness = useDirectCallAwareness();
  const cryptoRuntime = useCryptoRuntime();
  const [searchParams, setSearchParams] = useSearchParams();
  const [composerText, setComposerText] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [editingEncryptedMessageId, setEditingEncryptedMessageId] = useState<string | null>(null);
  const [selectedEncryptedReplyMessageId, setSelectedEncryptedReplyMessageId] =
    useState<string | null>(null);
  const [searchJumpNotice, setSearchJumpNotice] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const pendingPeerRef = useRef<string | null>(null);
  const encryptedAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const directCallAudioRef = useRef<HTMLAudioElement | null>(null);
  const isPageVisible = usePageVisibility();
  const sessionToken =
    authState.status === "authenticated" ? authState.token : "";
  const currentUserId =
    authState.status === "authenticated" ? authState.profile.id : "";
  const chats = useChats({
    enabled: authState.status === "authenticated",
    token: sessionToken,
    currentUserId,
    composerText,
    onUnauthenticated: () => expireSession(),
  });
  const encryptedMediaAttachmentDraft = useEncryptedMediaAttachmentDraft({
    enabled: authState.status === "authenticated",
    token: sessionToken,
    scope:
      chats.state.thread?.chat.id === undefined
        ? null
        : {
            kind: "direct",
            id: chats.state.thread.chat.id,
    },
    onUnauthenticated: () => expireSession(),
  });
  const voiceNoteRecorder = useVoiceNoteRecorder({
    enabled: authState.status === "authenticated",
  });
  const videoNoteRecorder = useVideoNoteRecorder({
    enabled: authState.status === "authenticated",
  });
  const applyEncryptedReadState = useEffectEvent(
    (
      chatId: string,
      readState: EncryptedDirectChatReadState | null,
      unreadCount: number,
    ) => {
      chats.replaceEncryptedReadState(chatId, readState, unreadCount);
    },
  );
  const discardEncryptedMediaNoteDrafts = useEffectEvent(() => {
    voiceNoteRecorder.discardRecording();
    videoNoteRecorder.discardRecording();
  });

  const requestedChatId = searchParams.get("chat")?.trim() ?? "";
  const requestedPeerUserId = searchParams.get("peer")?.trim() ?? "";
  const isThreadRouteActive = requestedChatId !== "" || requestedPeerUserId !== "";
  const requestedCallAction = searchParams.get("call")?.trim() ?? "";
  const searchJumpIntent = readSearchJumpIntent(searchParams);
  const syncRouteSelection = useEffectEvent(async () => {
    const action = resolveChatsRouteSyncAction({
      requestedChatId,
      requestedPeerUserId,
      selectedChatId: chats.state.selectedChatId,
      pendingPeerUserId: pendingPeerRef.current,
    });

    pendingPeerRef.current = action.nextPendingPeerUserId;

    if (action.kind === "open_chat") {
      await chats.openChat(action.chatId);
      return;
    }

    if (action.kind !== "ensure_peer_chat") {
      return;
    }

    const chatId = await chats.ensureDirectChat(action.peerUserId);
    if (!chatId) {
      pendingPeerRef.current = null;
      setSearchParams({}, { replace: true });
      return;
    }

    setSearchParams({ chat: chatId }, { replace: true });
  });

  useEffect(() => {
    if (authState.status !== "authenticated" || chats.state.status !== "ready") {
      return;
    }

    void syncRouteSelection();
  }, [
    authState.status,
    chats.state.selectedChatId,
    chats.state.status,
    requestedChatId,
    requestedPeerUserId,
  ]);

  useEffect(() => {
    const timeoutID = window.setTimeout(() => {
      setEditingEncryptedMessageId(null);
      setSelectedEncryptedReplyMessageId(null);
      setSearchJumpNotice(null);
      setHighlightedMessageId(null);
      discardEncryptedMediaNoteDrafts();
    }, 0);

    return () => {
      window.clearTimeout(timeoutID);
    };
  }, [chats.state.selectedChatId]);

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

  const selectedThread =
    !isThreadRouteActive || chats.state.thread === null
      ? null
      : requestedChatId !== ""
        ? chats.state.thread.chat.id === requestedChatId
          ? chats.state.thread
          : null
        : chats.state.selectedChatId !== null &&
            chats.state.thread.chat.id === chats.state.selectedChatId
          ? chats.state.thread
          : null;
  const selectedDirectCallAwarenessEntry = directCallAwareness.getEntry(
    selectedThread?.chat.id ?? null,
  );
  const encryptedLane = useEncryptedDirectMessageV2Lane({
    enabled: authState.status === "authenticated",
    token: sessionToken,
    chatId: selectedThread?.chat.id ?? null,
  });
  const encryptedMessageEntries = encryptedLane.items.filter(
    (
      item,
    ): item is EncryptedDirectMessageV2ProjectedMessageEntry => item.kind === "message",
  );
  const latestEncryptedMessage = encryptedMessageEntries.at(-1) ?? null;
  const activeEncryptedDirectChatId = selectedThread?.chat.id ?? null;
  const directCall = useDirectCallSession({
    enabled:
      authState.status === "authenticated" &&
      isThreadRouteActive &&
      selectedThread !== null,
    token: sessionToken,
    chat: selectedThread?.chat ?? null,
    awarenessEntry: selectedDirectCallAwarenessEntry,
    awarenessSyncStatus: directCallAwareness.state.syncStatus,
    currentUserId: authState.status === "authenticated" ? authState.profile.id : "",
    pageVisible: isPageVisible,
    refreshDirectChatCall: async (showLoading = false) => {
      const chatId = selectedThread?.chat.id ?? "";
      if (chatId === "") {
        return;
      }

      await directCallAwareness.refreshDirectChatCall(chatId, showLoading);
    },
    onUnauthenticated: () => expireSession(),
  });
  const directCallRemoteAudioStream = directCall.remoteAudioStream;
  const retryDirectCallRemoteAudioPlayback = directCall.retryRemoteAudioPlayback;
  const triggerRouteDirectCallJoin = useEffectEvent(() => {
    void directCall.joinCall();
  });
  const shouldAutoMarkEncryptedRead =
    authState.status === "authenticated" &&
    isThreadRouteActive &&
    isPageVisible &&
    selectedThread !== null &&
    encryptedLane.status === "ready" &&
    latestEncryptedMessage !== null &&
    latestEncryptedMessage.senderUserId !== authState.profile.id &&
    selectedThread.encryptedReadState?.selfPosition?.messageId !== latestEncryptedMessage.messageId;

  useEffect(() => {
    if (selectedThread === null || encryptedLane.status !== "ready") {
      return;
    }

    primeEncryptedDirectLocalSearchIndex({
      chat: selectedThread.chat,
      items: encryptedLane.items,
    });
  }, [encryptedLane.items, encryptedLane.status, selectedThread]);

  useEffect(() => {
    const audioElement = directCallAudioRef.current;
    if (audioElement === null) {
      return;
    }

    if (directCallRemoteAudioStream === null) {
      audioElement.pause();
      audioElement.srcObject = null;
      return;
    }

    audioElement.srcObject = directCallRemoteAudioStream;
    void retryDirectCallRemoteAudioPlayback(audioElement);

    return () => {
      if (audioElement.srcObject === directCallRemoteAudioStream) {
        audioElement.pause();
        audioElement.srcObject = null;
      }
    };
  }, [directCallRemoteAudioStream, retryDirectCallRemoteAudioPlayback]);

  useEffect(() => {
    if (
      requestedCallAction === "" ||
      selectedThread === null ||
      chats.state.threadStatus !== "ready"
    ) {
      return;
    }

    if (
      requestedChatId !== "" &&
      selectedThread.chat.id !== requestedChatId
    ) {
      return;
    }

    if (directCall.state.syncStatus === "loading") {
      return;
    }

    const nextSearchParams = new URLSearchParams(searchParams);
    const clearCallIntent = () => {
      nextSearchParams.delete("call");
      setSearchParams(nextSearchParams, { replace: true });
    };

    if (directCall.isLocallyJoined) {
      clearCallIntent();
      return;
    }

    if (directCall.state.call === null) {
      clearCallIntent();
      return;
    }

    if (!directCall.canJoin) {
      clearCallIntent();
      return;
    }

    clearCallIntent();
    triggerRouteDirectCallJoin();
  }, [
    chats.state.threadStatus,
    directCall.canJoin,
    directCall.isLocallyJoined,
    directCall.state.call,
    directCall.state.syncStatus,
    requestedCallAction,
    requestedChatId,
    searchParams,
    selectedThread,
    setSearchParams,
  ]);

  useEffect(() => {
    if (searchJumpIntent === null || chats.state.threadStatus !== "ready" || chats.state.thread === null) {
      return;
    }

    let timeoutID: number | null = null;
    const scheduleSearchJumpOutcome = (input: {
      notice: string | null;
      highlightedMessageId: string | null;
      anchorId: string | null;
    }) => {
      timeoutID = window.setTimeout(() => {
        setSearchJumpNotice(input.notice);
        setHighlightedMessageId(input.highlightedMessageId);
        if (input.anchorId !== null) {
          jumpToMessage(input.anchorId);
        }
        setSearchParams(clearSearchJumpParams(searchParams), { replace: true });
      }, 0);
    };

    if (requestedChatId !== "" && chats.state.thread.chat.id !== requestedChatId) {
      return;
    }

    if (searchJumpIntent.lane === "encrypted") {
      if (encryptedLane.status === "idle" || encryptedLane.status === "loading") {
        return;
      }

      if (encryptedLane.status !== "ready") {
        scheduleSearchJumpOutcome({
          notice:
            encryptedLane.errorMessage ??
            "Encrypted search result нельзя открыть в этом browser profile: local crypto runtime или bounded lane недоступны.",
          highlightedMessageId: null,
          anchorId: null,
        });
        return () => {
          if (timeoutID !== null) {
            window.clearTimeout(timeoutID);
          }
        };
      }

      const encryptedTarget =
        encryptedMessageEntries.find((entry) => entry.messageId === searchJumpIntent.messageId) ??
        null;
      if (encryptedTarget === null) {
        scheduleSearchJumpOutcome({
          notice:
            "Найденное encrypted сообщение пока не попало в текущее локально загруженное окно direct lane. Deep history backfill в этом slice не реализован.",
          highlightedMessageId: null,
          anchorId: null,
        });
        return () => {
          if (timeoutID !== null) {
            window.clearTimeout(timeoutID);
          }
        };
      }

      scheduleSearchJumpOutcome({
        notice: null,
        highlightedMessageId: encryptedTarget.messageId,
        anchorId: `encrypted-direct-message-${encryptedTarget.messageId}`,
      });
      return () => {
        if (timeoutID !== null) {
          window.clearTimeout(timeoutID);
        }
      };
    }

    const targetMessage = findJumpTarget(chats.state.thread.messages, searchJumpIntent.messageId);
    if (targetMessage === null) {
      scheduleSearchJumpOutcome({
        notice:
          "Найденное сообщение пока не попало в текущую загруженную историю direct chat. Переход ограничен последним загруженным окном сообщений.",
        highlightedMessageId: null,
        anchorId: null,
      });
      return () => {
        if (timeoutID !== null) {
          window.clearTimeout(timeoutID);
        }
      };
    }

    scheduleSearchJumpOutcome({
      notice: null,
      highlightedMessageId: targetMessage.id,
      anchorId: `direct-message-${targetMessage.id}`,
    });

    return () => {
      if (timeoutID !== null) {
        window.clearTimeout(timeoutID);
      }
    };
  }, [
    chats.state.thread,
    chats.state.threadStatus,
    encryptedLane.errorMessage,
    encryptedLane.status,
    encryptedMessageEntries,
    requestedChatId,
    searchJumpIntent,
    searchParams,
    setSearchParams,
  ]);

  useEffect(() => {
    if (
      !shouldAutoMarkEncryptedRead ||
      activeEncryptedDirectChatId === null ||
      latestEncryptedMessage === null
    ) {
      return;
    }

    let cancelled = false;

    void gatewayClient
      .markEncryptedDirectChatRead(
        sessionToken,
        activeEncryptedDirectChatId,
        latestEncryptedMessage.messageId,
      )
      .then((readUpdate) => {
        if (cancelled) {
          return;
        }

        applyEncryptedReadState(
          activeEncryptedDirectChatId,
          readUpdate.readState,
          readUpdate.unreadCount,
        );
      })
      .catch((error) => {
        const message = describeGatewayError(
          error,
          "Не удалось обновить encrypted read state через gateway.",
        );
        if (isGatewayErrorCode(error, "unauthenticated")) {
          expireSession();
          return;
        }

        setComposerError(message);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeEncryptedDirectChatId,
    expireSession,
    latestEncryptedMessage,
    sessionToken,
    shouldAutoMarkEncryptedRead,
  ]);

  const selectedPeer =
    selectedThread !== null
      ? getPeerParticipant(selectedThread.chat, currentUserId)
      : null;
  const [mobileWindowContentMode, setMobileWindowContentMode] = useState<"thread" | "info">(
    "thread",
  );
  const directWindowContentMode =
    desktopShellHost?.activeWindowContentMode ?? mobileWindowContentMode;
  const isDesktopTargetWindow = desktopShellHost !== null && isThreadRouteActive;
  const people = usePeople({
    enabled:
      authState.status === "authenticated" &&
      directWindowContentMode === "info" &&
      selectedPeer !== null,
    token: sessionToken,
    onUnauthenticated: expireSession,
  });
  const selectedFriend =
    selectedPeer !== null && people.state.status === "ready"
      ? people.state.snapshot.friends.find(
          (friend) =>
            friend.profile.id === selectedPeer.id || friend.profile.login === selectedPeer.login,
        ) ?? null
      : null;
  const selectedDirectProfile = selectedFriend?.profile ?? null;
  const pendingRemoveFriendLabel =
    selectedDirectProfile === null
      ? null
      : people.state.pendingLogins[selectedDirectProfile.login] ?? null;
  const selectedPeerTitle =
    selectedPeer?.nickname?.trim() ||
    selectedPeer?.login?.trim() ||
    "Личный чат";
  const pinnedMessages =
    selectedThread === null
      ? []
      : selectedThread.messages.filter((message) =>
          selectedThread.chat.pinnedMessageIds.includes(message.id) || message.pinned,
        );
  const encryptedMessageCount = encryptedLane.items.filter(
    (item) => item.kind === "message",
  ).length;
  const encryptedMessageIndex = new Map(
    encryptedMessageEntries.map((item) => [item.messageId, item] as const),
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
    selectedThread === null
      ? []
      : selectedThread.chat.encryptedPinnedMessageIds.map((messageId) => ({
          messageId,
          entry: encryptedMessageIndex.get(messageId) ?? null,
        }));
  const encryptedAttachmentDraft = encryptedMediaAttachmentDraft.draft;
  const uploadedEncryptedAttachmentDraft = encryptedMediaAttachmentDraft.uploadedDraft;
  const activeReadStatusLabel =
    selectedThread === null
      ? "Без видимого read state"
      : describeActiveDirectReadStatus(
          selectedThread.readState,
          selectedThread.encryptedReadState,
          encryptedLane.status === "ready" ? latestEncryptedMessage : null,
        );
  const activeReadStatusTone =
    selectedThread === null
      ? "neutral"
      : encryptedLane.status === "ready" && latestEncryptedMessage !== null
        ? selectedThread.encryptedReadState?.peerPosition
          ? "accent"
          : "neutral"
        : selectedThread.readState?.peerPosition
          ? "accent"
          : "neutral";
  const canPickEncryptedAttachment =
    !chats.state.isSendingMessage &&
    !encryptedMediaAttachmentDraft.isUploading &&
    editingEncryptedEntry === null;
  const canUseEncryptedMediaNoteEntry =
    selectedThread !== null &&
    !chats.state.isSendingMessage &&
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
  const canSendEncryptedDirectMessageV2 =
    selectedThread !== null &&
    !chats.state.isSendingMessage &&
    !cryptoRuntime.state.isActionPending &&
    !encryptedMediaAttachmentDraft.isUploading &&
    (normalizeComposerMessageText(composerText) !== "" ||
      uploadedEncryptedAttachmentDraft !== null);
  const encryptedSendHint = describeEncryptedBootstrapSendHint({
    chatSelected: selectedThread !== null,
    composerText,
    encryptedAttachmentDraft,
    hasEncryptedReplyTarget: selectedEncryptedReplyEntry !== null,
    isEditingEncryptedMessage: editingEncryptedEntry !== null,
    cryptoRuntimeState: cryptoRuntime.state,
  });

  useEffect(() => {
    if (desktopShellHost === null || selectedThread === null) {
      return;
    }

    desktopShellHost.syncCurrentRouteTitle(selectedPeerTitle);
  }, [desktopShellHost, selectedPeerTitle, selectedThread]);

  useEffect(() => {
    const timeoutID = window.setTimeout(() => {
      setMobileWindowContentMode("thread");
    }, 0);

    return () => {
      window.clearTimeout(timeoutID);
    };
  }, [requestedChatId, requestedPeerUserId]);

  if (authState.status !== "authenticated") {
    return null;
  }

  async function handleEncryptedDirectMessageV2Send() {
    if (selectedThread === null) {
      return;
    }

    const normalizedText = normalizeComposerMessageText(composerText);
    if (normalizedText === "" && uploadedEncryptedAttachmentDraft === null) {
      setComposerError(
        "Добавьте текст или подготовьте файл для отправки.",
      );
      chats.clearFeedback();
      return;
    }

    setComposerError(null);
    chats.clearFeedback();

    try {
      const attachmentDrafts =
        uploadedEncryptedAttachmentDraft === null ? [] : [uploadedEncryptedAttachmentDraft];
      const result =
        editingEncryptedEntry !== null
          ? await cryptoRuntime.sendEncryptedDirectMessageV2Edit(
              selectedThread.chat.id,
              editingEncryptedEntry.messageId,
              editingEncryptedEntry.revision + 1,
              normalizedText,
              selectedEncryptedReplyEntry?.messageId ?? null,
              attachmentDrafts,
            )
          : await cryptoRuntime.sendEncryptedDirectMessageV2Content(
              selectedThread.chat.id,
              normalizedText,
              selectedEncryptedReplyEntry?.messageId ?? null,
              attachmentDrafts,
            );
      if (result === null) {
        return;
      }

      publishLocalEncryptedDirectMessageV2Projection(result.localProjection);
      setComposerText("");
      setSelectedEncryptedReplyMessageId(null);
      setEditingEncryptedMessageId(null);
      encryptedMediaAttachmentDraft.markSendSucceeded();
    } catch (error) {
      encryptedMediaAttachmentDraft.markSendFailed();
      setComposerError(
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : "Не удалось отправить сообщение.",
      );
    }
  }

  async function handleDeleteEncryptedDirectMessageV2(
    message: EncryptedDirectMessageV2ProjectedMessageEntry,
  ) {
    if (selectedThread === null) {
      return;
    }

    setComposerError(null);
    chats.clearFeedback();

    try {
      const result = await cryptoRuntime.sendEncryptedDirectMessageV2Tombstone(
        selectedThread.chat.id,
        message.messageId,
        message.revision + 1,
      );
      if (result === null) {
        return;
      }

      publishLocalEncryptedDirectMessageV2Projection(result.localProjection);
      if (editingEncryptedMessageId === message.messageId) {
        setEditingEncryptedMessageId(null);
        setComposerText("");
      }
      if (selectedEncryptedReplyMessageId === message.messageId) {
        setSelectedEncryptedReplyMessageId(null);
      }
    } catch (error) {
      setComposerError(
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : "Не удалось удалить сообщение для всех.",
      );
    }
  }

  async function handleToggleEncryptedDirectPin(messageId: string, pinned: boolean) {
    if (selectedThread === null) {
      return;
    }

    setComposerError(null);
    chats.clearFeedback();

    try {
      if (pinned) {
        await gatewayClient.unpinEncryptedDirectMessageV2(
          sessionToken,
          selectedThread.chat.id,
          messageId,
        );
      } else {
        await gatewayClient.pinEncryptedDirectMessageV2(
          sessionToken,
          selectedThread.chat.id,
          messageId,
        );
      }
      await chats.reloadChats();
      await chats.openChat(selectedThread.chat.id);
    } catch (error) {
      setComposerError(
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : pinned
            ? "Не удалось снять закрепление."
            : "Не удалось закрепить сообщение.",
      );
    }
  }

  async function handleComposerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await handleEncryptedDirectMessageV2Send();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void handleEncryptedDirectMessageV2Send();
  }

  function handleBackToChatsList() {
    if (desktopShellHost !== null) {
      desktopShellHost.launchApp("chats");
      setComposerError(null);
      chats.clearFeedback();
      return;
    }

    setSearchParams({}, { replace: true });
    setComposerError(null);
    chats.clearFeedback();
  }

  function setDirectInfoMode(nextMode: "thread" | "info") {
    if (desktopShellHost !== null) {
      desktopShellHost.setActiveWindowContentMode(nextMode);
      return;
    }

    setMobileWindowContentMode(nextMode);
  }

  async function handleEncryptedAttachmentSelection(file: File | null) {
    if (file === null) {
      return;
    }

    setComposerError(null);
    chats.clearFeedback();
    await encryptedMediaAttachmentDraft.selectFile(file);
  }

  async function handleEncryptedMediaNoteSend(
    file: File | null,
    clearRecorderDraft: () => void,
  ) {
    if (selectedThread === null || file === null) {
      return;
    }

    setComposerError(null);
    chats.clearFeedback();

    try {
      const uploadedDraft = await encryptedMediaAttachmentDraft.selectFile(file);
      if (uploadedDraft === null) {
        return;
      }

      const result = await cryptoRuntime.sendEncryptedDirectMessageV2Content(
        selectedThread.chat.id,
        "",
        selectedEncryptedReplyEntry?.messageId ?? null,
        [uploadedDraft],
      );
      if (result === null) {
        return;
      }

      publishLocalEncryptedDirectMessageV2Projection(result.localProjection);
      setSelectedEncryptedReplyMessageId(null);
      encryptedMediaAttachmentDraft.markSendSucceeded();
      clearRecorderDraft();
    } catch (error) {
      encryptedMediaAttachmentDraft.markSendFailed();
      setComposerError(
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : "Не удалось отправить media note.",
      );
    }
  }

  return (
    <div
      className={`${styles.layout} ${isDesktopTargetWindow ? styles.desktopWindowLayout : ""}`}
    >
      {!isDesktopTargetWindow && (
        <section className={styles.heroCard}>
        <div className={styles.heroHeader}>
          <div>
            <p className={styles.cardLabel}>Chats</p>
            <h1 className={styles.title}>Личные чаты AeroChat</h1>
            <p className={styles.subtitle}>
              Окно личного чата показывает текущую переписку и обычный composer без разделения на
              разные пользовательские режимы отправки.
            </p>
          </div>

          <button
            className={styles.secondaryButton}
            disabled={
              chats.state.status === "loading" ||
              chats.state.isRefreshingList ||
              chats.state.isCreatingChat
            }
            onClick={() => {
              void chats.reloadChats();
            }}
            type="button"
          >
            {chats.state.isRefreshingList ? "Обновляем..." : "Обновить список"}
          </button>
        </div>

        <div className={styles.metrics}>
          <Metric label="Чаты" value={chats.state.chats.length} />
          <Metric label="Новых" value={selectedThread?.chat.encryptedUnreadCount ?? 0} />
          <Metric label="Закреплено" value={pinnedMessages.length} />
        </div>

        {chats.state.notice && <div className={styles.notice}>{chats.state.notice}</div>}
        {searchJumpNotice && <div className={styles.notice}>{searchJumpNotice}</div>}
        {(composerError || chats.state.actionErrorMessage) && (
          <div className={styles.error}>
            {composerError ?? chats.state.actionErrorMessage}
          </div>
        )}
        </section>
      )}

      <div
        className={`${styles.workspace} ${isDesktopTargetWindow ? styles.desktopWindowWorkspace : ""}`}
      >
        {!isDesktopTargetWindow && (
          <section
            className={styles.listPane}
            data-mobile-hidden={isThreadRouteActive}
          >
          <div className={styles.sectionCard}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.cardLabel}>Список</p>
                <h2 className={styles.sectionTitle}>Direct chats</h2>
              </div>
              <p className={styles.sectionDescription}>
                Новый чат создаётся только явным действием из раздела друзей.
              </p>
            </div>

            {requestedPeerUserId !== "" && chats.state.isCreatingChat && (
              <StateCard
                title="Подготавливаем чат"
                message="Ищем существующий direct thread или создаём новый через gateway."
              />
            )}

            {chats.state.status === "loading" && (
              <StateCard
                title="Загружаем direct chats"
                message="Получаем список чатов и готовим спокойный рабочий обзор."
              />
            )}

            {chats.state.status === "error" && (
              <StateCard
                title="Список чатов недоступен"
                message={
                  chats.state.screenErrorMessage ?? "Не удалось загрузить список direct chats."
                }
                action={
                  <button
                    className={styles.primaryButton}
                    onClick={() => {
                      void chats.reloadChats();
                    }}
                    type="button"
                  >
                    Повторить загрузку
                  </button>
                }
                tone="error"
              />
            )}

            {chats.state.status === "ready" && chats.state.chats.length === 0 && (
              <StateCard
                title="Direct chats пока нет"
                message="Откройте раздел друзей и создайте первый личный чат явным действием."
                action={
                  <Link className={styles.linkButton} to="/app/people">
                    Перейти к друзьям
                  </Link>
                }
              />
            )}

            {chats.state.status === "ready" && chats.state.chats.length > 0 && (
              <div className={styles.chatList}>
                {chats.state.chats.map((chat) => {
                  const peer = getPeerParticipant(chat, authState.profile.id);
                  const isActive = chat.id === requestedChatId;

                  return (
                    <button
                      key={chat.id}
                      className={styles.chatItem}
                      data-active={isActive}
                      onClick={() => {
                        if (desktopShellHost !== null) {
                          desktopShellHost.openDirectChat({
                            chatId: chat.id,
                            title: peer?.nickname ?? peer?.login ?? "Личный чат",
                          });
                          return;
                        }

                        setSearchParams({ chat: chat.id });
                      }}
                      type="button"
                    >
                      <span className={styles.avatarBadge} aria-hidden="true">
                        {getParticipantInitials(peer)}
                      </span>

                      <div className={styles.chatItemBody}>
                        <div className={styles.chatItemHeader}>
                          <div>
                            <h3 className={styles.chatItemTitle}>
                              {peer?.nickname ?? "Direct chat"}
                            </h3>
                            <p className={styles.chatItemLogin}>
                              {peer ? `@${peer.login}` : "Участник недоступен"}
                            </p>
                          </div>
                          <span className={styles.metaTag}>
                            {formatDateTime(chat.updatedAt)}
                          </span>
                        </div>

                        <p className={styles.chatItemDescription}>
                          {describeChatPreview(chat, peer)}
                        </p>

                        <div className={styles.chatItemFooter}>
                          {chat.unreadCount > 0 && (
                            <span className={styles.statusBadge} data-tone="accent">
                              Непрочитано: {chat.unreadCount}
                            </span>
                          )}
                          {directCallAwareness.getEntry(chat.id) && (
                            <span className={styles.statusBadge} data-tone="success">
                              Активный звонок
                            </span>
                          )}
                          {chat.encryptedUnreadCount > 0 && (
                            <span className={styles.statusBadge} data-tone="accent">
                              Новых: {chat.encryptedUnreadCount}
                            </span>
                          )}
                          {chat.pinnedMessageIds.length > 0 && (
                            <span className={styles.statusBadge}>
                              Закреплено: {chat.pinnedMessageIds.length}
                            </span>
                          )}
                          {isActive && (
                            <span className={styles.statusBadge} data-tone="accent">
                              Открыт
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          </section>
        )}

        <section
          className={`${styles.threadPane} ${isDesktopTargetWindow ? styles.desktopThreadPane : ""}`}
          data-mobile-hidden={!isThreadRouteActive && chats.state.chats.length > 0}
        >
          <div
            className={`${styles.sectionCard} ${isDesktopTargetWindow ? styles.desktopThreadSection : ""}`}
          >
            {!isDesktopTargetWindow && (
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.cardLabel}>Thread</p>
                  <h2 className={styles.sectionTitle}>
                    {selectedPeer ? selectedPeer.nickname : "Выберите чат"}
                  </h2>
                </div>

                <div className={styles.headerActions}>
                  <button
                    className={styles.secondaryButton}
                    onClick={handleBackToChatsList}
                    type="button"
                  >
                    Назад к списку
                  </button>

                  {selectedThread && (
                    <button
                      className={styles.secondaryButton}
                      onClick={() => {
                        void chats.openChat(selectedThread.chat.id);
                      }}
                      type="button"
                    >
                      Обновить thread
                    </button>
                  )}
                </div>
              </div>
            )}

            {isDesktopTargetWindow && chats.state.notice && (
              <div className={styles.notice}>{chats.state.notice}</div>
            )}
            {isDesktopTargetWindow && searchJumpNotice && (
              <div className={styles.notice}>{searchJumpNotice}</div>
            )}
            {isDesktopTargetWindow && (composerError || chats.state.actionErrorMessage) && (
              <div className={styles.error}>
                {composerError ?? chats.state.actionErrorMessage}
              </div>
            )}

            {!isDesktopTargetWindow &&
              !isThreadRouteActive &&
              chats.state.status === "ready" &&
              chats.state.chats.length > 0 && (
              <StateCard
                title="Чат ещё не выбран"
                message="На широком экране можно держать список и пустой thread рядом. На узком экране сначала показываем обзор чатов."
              />
              )}

            {requestedPeerUserId !== "" && chats.state.isCreatingChat && (
              <StateCard
                title="Открываем direct thread"
                message="Подтягиваем chat snapshot и готовим thread к чтению и отправке."
              />
            )}

            {isThreadRouteActive && chats.state.threadStatus === "loading" && (
              <StateCard
                title="Загружаем thread"
                message="Получаем chat snapshot, сообщения и видимый read state без realtime-предположений."
              />
            )}

            {isThreadRouteActive && chats.state.threadStatus === "error" && chats.state.selectedChatId && (
              <StateCard
                title="Thread недоступен"
                message={chats.state.threadErrorMessage ?? "Не удалось загрузить выбранный чат."}
                action={
                  <button
                    className={styles.primaryButton}
                    onClick={() => {
                      void chats.openChat(chats.state.selectedChatId ?? "");
                    }}
                    type="button"
                  >
                    Повторить
                  </button>
                }
                tone="error"
              />
            )}

            {selectedThread && chats.state.threadStatus === "ready" && (
              directWindowContentMode === "info" ? (
                <div className={styles.threadLayout}>
                  <section className={styles.profilePanel}>
                    <div className={styles.panelHeader}>
                      <div>
                        <p className={styles.cardLabel}>Direct info</p>
                        <h3 className={styles.blockTitle}>
                          {selectedDirectProfile?.nickname ?? selectedPeer?.nickname ?? "Собеседник"}
                        </h3>
                        <p className={styles.threadDescription}>
                          @{selectedDirectProfile?.login ?? selectedPeer?.login ?? "unknown"}
                        </p>
                      </div>

                      <div className={styles.headerActions}>
                        <button
                          className={styles.secondaryButton}
                          onClick={() => {
                            setDirectInfoMode("thread");
                          }}
                          type="button"
                        >
                          Назад к переписке
                        </button>
                        {!isDesktopTargetWindow && (
                          <button
                            className={styles.secondaryButton}
                            onClick={handleBackToChatsList}
                            type="button"
                          >
                            Назад к списку
                          </button>
                        )}
                      </div>
                    </div>

                    <div className={styles.profileHero}>
                      <div className={styles.threadIdentity}>
                        <span
                          className={`${styles.avatarBadge} ${styles.avatarBadgeLarge}`}
                          aria-hidden="true"
                        >
                          {getParticipantInitials(selectedPeer)}
                        </span>

                        <div>
                          <p className={styles.threadEyebrow}>Профиль и информация</p>
                          <h3 className={styles.threadTitle}>
                            {selectedDirectProfile?.nickname ?? selectedPeer?.nickname ?? "Собеседник"}
                          </h3>
                          <p className={styles.threadDescription}>
                            {describeDirectProfileSummary(selectedDirectProfile)}
                          </p>
                        </div>
                      </div>

                      <div className={styles.profileActions}>
                        {selectedDirectProfile !== null && (
                          <button
                            className={styles.secondaryButton}
                            disabled={pendingRemoveFriendLabel !== null}
                            onClick={() => {
                              void people.removeFriend(selectedDirectProfile.login);
                            }}
                            type="button"
                          >
                            {pendingRemoveFriendLabel ?? "Удалить из друзей"}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className={styles.threadStatusRow}>
                      <StatusPill
                        label={describePresenceStatus(selectedThread.presenceState)}
                        tone={selectedThread.presenceState?.peerPresence ? "success" : "neutral"}
                      />
                      <StatusPill
                        label={activeReadStatusLabel}
                        tone={activeReadStatusTone}
                      />
                      {selectedThread.typingState?.peerTyping && (
                        <StatusPill
                          label={describeTypingStatus(selectedThread.typingState)}
                          tone="accent"
                        />
                      )}
                    </div>

                    {people.state.status === "loading" && (
                      <div className={styles.notice}>
                        Подтягиваем friends/profile snapshot, чтобы показать актуальную карточку
                        контакта без открытия отдельного окна.
                      </div>
                    )}

                    {people.state.status === "error" && (
                      <div className={styles.error}>
                        {people.state.screenErrorMessage ??
                          "Не удалось загрузить данные контакта через people surface."}
                      </div>
                    )}

                    {people.state.actionErrorMessage && (
                      <div className={styles.error}>{people.state.actionErrorMessage}</div>
                    )}

                    {people.state.notice && <div className={styles.notice}>{people.state.notice}</div>}

                    <div className={styles.profileFactsGrid}>
                      <article className={styles.profileFactCard}>
                        <p className={styles.cardLabel}>Контакт</p>
                        <dl className={styles.profileFactList}>
                          <div>
                            <dt>Login</dt>
                            <dd>@{selectedDirectProfile?.login ?? selectedPeer?.login ?? "unknown"}</dd>
                          </div>
                          <div>
                            <dt>В чате с</dt>
                            <dd>{formatDateTime(selectedThread.chat.createdAt)}</dd>
                          </div>
                          <div>
                            <dt>Последняя активность</dt>
                            <dd>{formatDateTime(selectedThread.chat.updatedAt)}</dd>
                          </div>
                          <div>
                            <dt>Друзья с</dt>
                            <dd>
                              {selectedFriend === null
                                ? "нет friend snapshot"
                                : formatDateTime(selectedFriend.friendsSince)}
                            </dd>
                          </div>
                        </dl>
                      </article>

                      <article className={styles.profileFactCard}>
                        <p className={styles.cardLabel}>Публичный профиль</p>
                        <dl className={styles.profileFactList}>
                          <div>
                            <dt>Status</dt>
                            <dd>{selectedDirectProfile?.statusText ?? "не задан"}</dd>
                          </div>
                          <div>
                            <dt>Bio</dt>
                            <dd>{selectedDirectProfile?.bio ?? "не задано"}</dd>
                          </div>
                          <div>
                            <dt>Локация</dt>
                            <dd>{describeDirectProfileLocation(selectedDirectProfile)}</dd>
                          </div>
                          <div>
                            <dt>День рождения</dt>
                            <dd>{selectedDirectProfile?.birthday ?? "не задан"}</dd>
                          </div>
                        </dl>
                      </article>

                      <article className={styles.profileFactCard}>
                        <p className={styles.cardLabel}>Приватность и thread</p>
                        <dl className={styles.profileFactList}>
                          <div>
                            <dt>Read receipts</dt>
                            <dd>
                              {selectedDirectProfile === null
                                ? "нет profile snapshot"
                                : selectedDirectProfile.readReceiptsEnabled
                                  ? "включены"
                                  : "скрыты"}
                            </dd>
                          </div>
                          <div>
                            <dt>Presence</dt>
                            <dd>
                              {selectedDirectProfile === null
                                ? "нет profile snapshot"
                                : selectedDirectProfile.presenceEnabled
                                  ? "разрешён"
                                  : "скрыт"}
                            </dd>
                          </div>
                          <div>
                            <dt>Typing visibility</dt>
                            <dd>
                              {selectedDirectProfile === null
                                ? "нет profile snapshot"
                                : selectedDirectProfile.typingVisibilityEnabled
                                  ? "видима"
                                  : "скрыта"}
                            </dd>
                          </div>
                          <div>
                            <dt>Закрепления</dt>
                            <dd>
                              {selectedThread.chat.pinnedMessageIds.length +
                                selectedThread.chat.encryptedPinnedMessageIds.length}
                            </dd>
                          </div>
                        </dl>
                      </article>
                    </div>
                  </section>
                </div>
              ) : (
              <div className={styles.threadLayout}>
                <section className={styles.threadHero}>
                  <button
                    className={styles.threadIdentityButton}
                    onClick={() => {
                      setDirectInfoMode("info");
                    }}
                    type="button"
                  >
                    <div className={styles.threadIdentity}>
                      <span className={`${styles.avatarBadge} ${styles.avatarBadgeLarge}`} aria-hidden="true">
                        {getParticipantInitials(selectedPeer)}
                      </span>

                      <div>
                        <p className={styles.threadEyebrow}>Direct thread</p>
                        <h3 className={styles.threadTitle}>
                          {selectedPeer?.nickname ?? "Собеседник"}
                        </h3>
                        <p className={styles.threadDescription}>
                          {selectedPeer ? `@${selectedPeer.login}` : "Участник недоступен"}
                        </p>
                        <p className={styles.identityActionHint}>
                          Открыть профиль и информацию в этом же окне
                        </p>
                      </div>
                    </div>
                  </button>

                  <div className={styles.threadStatusRow}>
                    <StatusPill
                      label={describePresenceStatus(selectedThread.presenceState)}
                      tone={selectedThread.presenceState?.peerPresence ? "success" : "neutral"}
                    />
                    <StatusPill
                      label={activeReadStatusLabel}
                      tone={activeReadStatusTone}
                    />
                    {selectedThread.typingState?.peerTyping && (
                      <StatusPill
                        label={describeTypingStatus(selectedThread.typingState)}
                        tone="accent"
                      />
                    )}
                  </div>
                </section>

                <section className={styles.callCard}>
                  <div className={styles.blockHeader}>
                    <div>
                      <p className={styles.cardLabel}>Audio call</p>
                      <h3 className={styles.blockTitle}>Прямой аудиозвонок</h3>
                    </div>
                    <span className={styles.metaTag}>
                      {describeDirectCallPhaseLabel(directCall.phase)}
                    </span>
                  </div>

                  <div className={styles.callMeta}>
                    <StatusPill
                      label={describeDirectCallPeerStatus(
                        directCall.remoteParticipant !== null,
                        selectedPeer?.nickname ?? "Собеседник",
                      )}
                      tone={directCall.remoteParticipant ? "success" : "neutral"}
                    />
                    {directCall.state.call && (
                      <StatusPill
                        label={`Control-plane: ${describeDirectCallServerState(directCall.state.call.status)}`}
                        tone={directCall.state.call.status === "active" ? "accent" : "neutral"}
                      />
                    )}
                    {directCall.isLocallyJoined && (
                      <StatusPill
                        label="Вы подключены"
                        tone="accent"
                      />
                    )}
                  </div>

                  <p className={styles.callDescription}>
                    Узкий browser bootstrap поверх текущего RTC control plane: active call
                    остаётся server-backed, а local audio session можно явно вернуть после
                    ухода из thread. Только direct chat, только audio, без video/device scope.
                  </p>

                  <div className={styles.callActions}>
                    {directCall.canStart && (
                      <button
                        className={styles.primaryButton}
                        onClick={() => {
                          void directCall.startCall();
                        }}
                        type="button"
                      >
                        Позвонить
                      </button>
                    )}

                    {directCall.canJoin && (
                      <button
                        className={styles.primaryButton}
                        onClick={() => {
                          void directCall.joinCall();
                        }}
                        type="button"
                      >
                        {directCall.selfParticipant ? "Вернуться в звонок" : "Присоединиться"}
                      </button>
                    )}

                    {directCall.canLeave && !directCall.canEnd && (
                      <button
                        className={styles.secondaryButton}
                        onClick={() => {
                          void directCall.leaveCall();
                        }}
                        type="button"
                      >
                        Покинуть звонок
                      </button>
                    )}

                    {directCall.canEnd && (
                      <button
                        className={styles.secondaryButton}
                        onClick={() => {
                          void directCall.endCall();
                        }}
                        type="button"
                      >
                        Завершить звонок
                      </button>
                    )}
                  </div>

                  {directCall.state.errorMessage && (
                    <div className={styles.callFeedback} data-tone="error">
                      <p>{directCall.state.errorMessage}</p>
                      <button
                        className={styles.ghostButton}
                        onClick={() => {
                          directCall.dismissError();
                        }}
                        type="button"
                      >
                        Скрыть
                      </button>
                    </div>
                  )}

                  {directCall.state.remoteAudioState === "blocked" && (
                    <div className={styles.callFeedback}>
                      <p>
                        Браузер заблокировал autoplay удалённого аудио. Подтвердите воспроизведение
                        вручную.
                      </p>
                      <button
                        className={styles.ghostButton}
                        onClick={() => {
                          void directCall.retryRemoteAudioPlayback(directCallAudioRef.current);
                        }}
                        type="button"
                      >
                        Включить звук
                      </button>
                    </div>
                  )}

                  <audio
                    autoPlay
                    playsInline
                    ref={directCallAudioRef}
                    className={styles.hiddenAudio}
                  />
                </section>

                {selectedThread.chat.encryptedPinnedMessageIds.length > 0 && (
                  <section className={styles.pinnedStrip}>
                    <div className={styles.blockHeader}>
                      <div>
                        <p className={styles.cardLabel}>Закреплённые</p>
                        <h3 className={styles.blockTitle}>Закреплённые сообщения</h3>
                      </div>
                      <span className={styles.metaTag}>
                        {selectedThread.chat.encryptedPinnedMessageIds.length}
                      </span>
                    </div>

                    <div className={styles.pinnedList}>
                      {encryptedPinnedMessages.map(({ messageId, entry }) => (
                        <article key={messageId} className={styles.pinnedCard}>
                          <div className={styles.pinnedHeader}>
                            <strong>
                              {entry === null
                                ? "Сообщение"
                                : entry.senderUserId === authState.profile.id
                                  ? "Вы"
                                  : selectedPeer?.nickname ?? "Собеседник"}
                            </strong>
                            <span className={styles.pinnedMeta}>
                              {entry === null
                                ? "Локально не разрешено"
                                : formatDateTime(entry.createdAt)}
                            </span>
                          </div>
                          <p className={styles.pinnedText}>
                            {describeEncryptedPinnedPreview(entry)}
                          </p>
                        </article>
                      ))}
                    </div>
                  </section>
                )}

                <section className={styles.messagesPanel}>
                  <div className={styles.blockHeader}>
                    <div>
                      <p className={styles.cardLabel}>Сообщения</p>
                      <h3 className={styles.blockTitle}>Переписка</h3>
                    </div>
                    <div className={styles.headerActions}>
                      {selectedThread.chat.encryptedUnreadCount > 0 && (
                        <span className={styles.statusBadge} data-tone="accent">
                          Новых: {selectedThread.chat.encryptedUnreadCount}
                        </span>
                      )}
                      <span className={styles.metaTag}>
                        {encryptedLane.status === "ready"
                          ? `${encryptedMessageCount} сообщений`
                          : encryptedLane.status === "unavailable"
                            ? "Недоступно"
                            : "Загружаем"}
                      </span>
                    </div>
                  </div>

                  <p className={styles.encryptedLaneDescription}>
                    Текущая переписка открывается в обычном чате. Если часть истории недоступна,
                    это показывается отдельным честным состоянием ниже.
                  </p>

                  <div className={styles.messagesList}>
                    {encryptedLane.status === "loading" && (
                      <StateCard
                        title="Загружаем сообщения"
                        message="Подготавливаем текущую переписку для чтения."
                      />
                    )}

                    {encryptedLane.status === "unavailable" && (
                      <StateCard
                        title="Сообщения недоступны"
                        message={
                          encryptedLane.errorMessage ??
                          "Для этого браузера не удалось подготовить переписку."
                        }
                      />
                    )}

                    {encryptedLane.status === "error" && (
                      <StateCard
                        title="Не удалось загрузить сообщения"
                        message={
                          encryptedLane.errorMessage ??
                          "Не удалось подготовить переписку."
                        }
                        tone="error"
                      />
                    )}

                    {encryptedLane.status === "ready" &&
                      encryptedLane.items.length === 0 && (
                        <StateCard
                          title="Сообщений пока нет"
                          message={describeEncryptedDirectMessageV2LaneEmptyState(0)}
                        />
                      )}

                    {encryptedLane.status === "ready" &&
                      encryptedLane.items.map((item) =>
                        renderEncryptedDirectMessageV2Entry({
                          item,
                          accessToken: sessionToken,
                          currentUserId: authState.profile.id,
                          peerNickname: selectedPeer?.nickname ?? "Собеседник",
                          replyTarget:
                            item.kind === "message"
                              ? resolveEncryptedDirectReplyTarget(
                                  encryptedMessageIndex,
                                  item.replyToMessageId,
                                  authState.profile.id,
                                  selectedPeer?.nickname ?? "Собеседник",
                                )
                              : null,
                          isPinned:
                            item.kind === "message" &&
                            selectedThread.chat.encryptedPinnedMessageIds.includes(
                              item.messageId,
                            ),
                          onJumpToReplyTarget: (messageId) => {
                            jumpToMessage(`encrypted-direct-message-${messageId}`);
                          },
                          onReply:
                            item.kind !== "message"
                              ? undefined
                              : () => {
                                  setSelectedEncryptedReplyMessageId(item.messageId);
                                  setEditingEncryptedMessageId(null);
                                  setComposerError(null);
                                  chats.clearFeedback();
                                },
                          onEdit:
                            item.kind !== "message" ||
                            item.senderUserId !== authState.profile.id ||
                            item.isTombstone
                              ? undefined
                              : () => {
                                  setEditingEncryptedMessageId(item.messageId);
                                  setSelectedEncryptedReplyMessageId(item.replyToMessageId);
                                  setComposerText(item.text ?? "");
                                  setComposerError(null);
                                  chats.clearFeedback();
                                },
                          onDeleteForEveryone:
                            item.kind !== "message" ||
                            item.senderUserId !== authState.profile.id ||
                            item.isTombstone
                              ? undefined
                              : () => {
                                  void handleDeleteEncryptedDirectMessageV2(item);
                                },
                          onTogglePin:
                            item.kind !== "message"
                              ? undefined
                              : () => {
                                  void handleToggleEncryptedDirectPin(
                                    item.messageId,
                                    selectedThread.chat.encryptedPinnedMessageIds.includes(
                                      item.messageId,
                                    ),
                                  );
                                },
                        }),
                      )}
                  </div>
                </section>

                <section className={styles.messagesPanel}>
                  <div className={styles.blockHeader}>
                    <div>
                      <p className={styles.cardLabel}>История</p>
                      <h3 className={styles.blockTitle}>Ранние сообщения недоступны</h3>
                    </div>
                    <span className={styles.metaTag}>
                      Недоступно
                    </span>
                  </div>

                  <div className={styles.messagesList}>
                    <StateCard
                      title="История недоступна"
                      message="В этом окне доступны текущие сообщения. Более ранняя история здесь сейчас не открывается."
                    />
                  </div>
                </section>

                <section className={styles.composerCard}>
                  <div className={styles.blockHeader}>
                    <div>
                      <p className={styles.cardLabel}>Сообщение</p>
                      <h3 className={styles.blockTitle}>Написать сообщение</h3>
                    </div>
                    <span className={styles.composerHint}>
                      Enter отправляет сообщение, Shift+Enter переносит строку
                    </span>
                  </div>

                  <form className={styles.composer} onSubmit={handleComposerSubmit}>
                    {selectedEncryptedReplyEntry && (
                      <div className={styles.replyComposerCard}>
                        <div>
                          <p className={styles.replyPreviewAuthor}>
                            Encrypted reply на{" "}
                            {selectedEncryptedReplyEntry.senderUserId === authState.profile.id
                              ? "ваше сообщение"
                              : selectedPeer?.nickname ?? "сообщение собеседника"}
                          </p>
                          <p className={styles.replyPreviewText}>
                            {describeEncryptedDirectComposerReplyTarget(
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
                            Encrypted edit revision {editingEncryptedEntry.revision + 1}
                          </p>
                          <p className={styles.replyPreviewText}>
                            {describeEncryptedDirectComposerReplyTarget(editingEncryptedEntry)}
                          </p>
                        </div>
                        <button
                          className={styles.ghostButton}
                          onClick={() => {
                            setEditingEncryptedMessageId(null);
                            setSelectedEncryptedReplyMessageId(null);
                            setComposerText("");
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
                        Прикрепите файл вручную или используйте voice/video note ниже. Всё уходит
                        через тот же encrypted attachment flow.
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
                        void handleEncryptedMediaNoteSend(
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
                        void handleEncryptedMediaNoteSend(
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
                      <span>Текст сообщения</span>
                      <textarea
                        disabled={
                          chats.state.isSendingMessage ||
                          encryptedMediaAttachmentDraft.isUploading
                        }
                        maxLength={4000}
                        onChange={(event) => {
                          setComposerText(event.target.value);
                          setComposerError(null);
                          chats.clearFeedback();
                        }}
                        onKeyDown={handleComposerKeyDown}
                        placeholder="Напишите спокойное текстовое сообщение"
                        rows={5}
                        value={composerText}
                      />
                    </label>

                    <div className={styles.composerFooter}>
                      <span className={styles.characterCount}>
                        {composerText.trim().length}/4000
                      </span>

                      <div className={styles.actions}>
                        <button
                          className={styles.secondaryButton}
                          disabled={!canSendEncryptedDirectMessageV2}
                          onClick={() => {
                            void handleEncryptedDirectMessageV2Send();
                          }}
                          type="button"
                        >
                          {cryptoRuntime.state.isActionPending
                            ? "Собираем..."
                            : editingEncryptedEntry !== null
                              ? "Сохранить правки"
                              : "Отправить"}
                        </button>
                      </div>
                    </div>
                    <p className={styles.attachmentHint}>{encryptedSendHint}</p>
                  </form>
                </section>
              </div>
              )
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

interface MetricProps {
  label: string;
  value: number;
}

function Metric({ label, value }: MetricProps) {
  return (
    <div className={styles.metricCard}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

interface StatusPillProps {
  label: string;
  tone?: "neutral" | "accent" | "success";
}

function StatusPill({ label, tone = "neutral" }: StatusPillProps) {
  return (
    <span className={styles.statusBadge} data-tone={tone}>
      {label}
    </span>
  );
}

interface StateCardProps {
  title: string;
  message: string;
  action?: ReactNode;
  tone?: "default" | "error";
}

function StateCard({
  title,
  message,
  action,
  tone = "default",
}: StateCardProps) {
  return (
    <section className={styles.stateCard} data-tone={tone}>
      <p className={styles.cardLabel}>Chats state</p>
      <h3 className={styles.stateTitle}>{title}</h3>
      <p className={styles.stateMessage}>{message}</p>
      {action && <div className={styles.actions}>{action}</div>}
    </section>
  );
}

interface RenderEncryptedDirectMessageV2EntryInput {
  item: EncryptedDirectMessageV2ProjectionEntry;
  accessToken: string;
  currentUserId: string;
  peerNickname: string;
  replyTarget: EncryptedReplyTargetDescriptor | null;
  isPinned: boolean;
  onJumpToReplyTarget(messageId: string): void;
  onReply?: () => void;
  onEdit?: () => void;
  onDeleteForEveryone?: () => void;
  onTogglePin?: () => void;
}

function renderEncryptedDirectMessageV2Entry(input: RenderEncryptedDirectMessageV2EntryInput) {
  const isOwn = input.item.senderUserId === input.currentUserId;
  const authorLabel = isOwn ? "Вы" : input.peerNickname;

  if (input.item.kind === "failure") {
    return (
      <article
        key={input.item.key}
        className={styles.messageRow}
        data-own={isOwn}
      >
        <div className={styles.messageBubble} data-own={isOwn}>
          <div className={styles.messageHeader}>
            <div>
              <p className={styles.messageAuthor}>{authorLabel}</p>
              <p className={styles.messageMeta}>{formatDateTime(input.item.createdAt)}</p>
            </div>
            <div className={styles.messageBadges}>
              <span className={styles.statusBadge}>Decrypt failed</span>
            </div>
          </div>
          <p className={styles.encryptedFailureText}>
            {describeEncryptedDirectMessageV2Failure(input.item)}
          </p>
        </div>
      </article>
    );
  }

  return (
    <article
      key={input.item.key}
      className={styles.messageRow}
      data-own={isOwn}
      id={`encrypted-direct-message-${input.item.messageId}`}
    >
      <div className={styles.messageBubble} data-own={isOwn}>
        <div className={styles.messageHeader}>
          <div>
            <p className={styles.messageAuthor}>{authorLabel}</p>
            <p className={styles.messageMeta}>{formatDateTime(input.item.createdAt)}</p>
          </div>
          <div className={styles.messageBadges}>
            <span className={styles.statusBadge} data-tone="accent">
              Encrypted v2
            </span>
            {input.isPinned && <span className={styles.statusBadge}>Pin</span>}
            {input.item.editedAt && <span className={styles.statusBadge}>Изменено</span>}
            {input.item.isTombstone && <span className={styles.statusBadge}>Удалено</span>}
          </div>
        </div>
        <div className={styles.messageBody}>
          {input.item.isTombstone ? (
            <p className={styles.tombstoneText}>Сообщение удалено для всех.</p>
          ) : (
            <>
              {input.replyTarget && (
                <button
                  className={styles.replyPreviewCard}
                  disabled={input.replyTarget.messageId === null}
                  onClick={() => {
                    const replyTarget = input.replyTarget;
                    if (replyTarget !== null && replyTarget.messageId !== null) {
                      input.onJumpToReplyTarget(replyTarget.messageId);
                    }
                  }}
                  type="button"
                >
                  <span className={styles.replyPreviewAuthor}>
                    {input.replyTarget.authorLabel}
                  </span>
                  <span className={styles.replyPreviewText}>
                    {input.replyTarget.previewText}
                  </span>
                </button>
              )}
              {input.item.text && (
                <div className={styles.messageText}>
                  <SafeMessageMarkdown text={input.item.text} />
                </div>
              )}
              {input.item.attachments.length > 0 && (
                <EncryptedMessageAttachmentList
                  accessToken={input.accessToken}
                  attachments={input.item.attachments}
                  tone={isOwn ? "own" : "other"}
                />
              )}
              {!input.item.text && input.item.attachments.length === 0 && (
                <p className={styles.encryptedFailureText}>
                  У сообщения нет доступного содержимого для показа.
                </p>
              )}
            </>
          )}
        </div>
        {!input.item.isTombstone && (
          <div className={styles.actions}>
            {input.onTogglePin && (
              <button
                className={styles.ghostButton}
                onClick={input.onTogglePin}
                type="button"
              >
                {input.isPinned ? "Снять закрепление" : "Закрепить"}
              </button>
            )}
            {input.onReply && (
              <button className={styles.ghostButton} onClick={input.onReply} type="button">
                Ответить
              </button>
            )}
            {input.onEdit && (
              <button className={styles.ghostButton} onClick={input.onEdit} type="button">
                Редактировать
              </button>
            )}
            {input.onDeleteForEveryone && (
              <button
                className={styles.ghostButton}
                onClick={input.onDeleteForEveryone}
                type="button"
              >
                Удалить для всех
              </button>
            )}
          </div>
        )}
        <p className={styles.editMeta}>
          stored {formatDateTime(input.item.storedAt)}
          {input.item.editedAt ? ` • edited ${formatDateTime(input.item.editedAt)}` : ""}
          {input.item.deletedAt
            ? ` • удалено ${formatDateTime(input.item.deletedAt)}`
            : ""}
        </p>
      </div>
    </article>
  );
}

interface EncryptedReplyTargetDescriptor {
  messageId: string | null;
  authorLabel: string;
  previewText: string;
}

function describeDirectCallPhaseLabel(
  phase:
    | "idle"
    | "starting"
    | "ringing"
    | "connecting"
    | "connected"
    | "ending"
    | "ended"
    | "failed",
): string {
  switch (phase) {
    case "starting":
      return "Запускаем";
    case "ringing":
      return "Ожидание";
    case "connecting":
      return "Соединяем";
    case "connected":
      return "Подключён";
    case "ending":
      return "Завершаем";
    case "ended":
      return "Завершён";
    case "failed":
      return "Сбой";
    case "idle":
    default:
      return "Не активен";
  }
}

function describeDirectCallPeerStatus(hasRemoteParticipant: boolean, peerName: string): string {
  if (hasRemoteParticipant) {
    return `${peerName} уже в звонке`;
  }

  return `${peerName} ещё не подключился`;
}

function describeDirectCallServerState(state: "active" | "ended"): string {
  return state === "active" ? "активен" : "завершён";
}

function getPeerParticipant(chat: DirectChat, currentUserId: string): ChatUser | null {
  return chat.participants.find((participant) => participant.id !== currentUserId) ?? null;
}

function getParticipantInitials(peer: ChatUser | null): string {
  if (!peer) {
    return "DC";
  }

  return peer.nickname
    .split(/\s+/)
    .filter((part) => part !== "")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || peer.login.slice(0, 2).toUpperCase();
}

function describeChatPreview(chat: DirectChat, peer: ChatUser | null): string {
  if (chat.pinnedMessageIds.length > 0) {
    return `Есть закреплённые сообщения и готовый direct thread с ${peer ? `@${peer.login}` : "собеседником"}.`;
  }

  if (peer) {
    return `Личный чат с @${peer.login} с подключённым realtime transport foundation и без тяжёлого shell-overhead.`;
  }

  return "Личный thread готов к открытию.";
}

function describeActiveDirectReadStatus(
  legacyReadState: DirectChatReadState | null,
  encryptedReadState: EncryptedDirectChatReadState | null,
  latestEncryptedMessage: EncryptedDirectMessageV2ProjectedMessageEntry | null,
): string {
  if (latestEncryptedMessage === null) {
    return describeReadStatus(legacyReadState);
  }

  const peerPosition = encryptedReadState?.peerPosition;
  if (peerPosition === null || peerPosition === undefined) {
    return "Encrypted read state не виден";
  }
  if (peerPosition.messageId === latestEncryptedMessage.messageId) {
    return `Прочитано · ${formatDateTime(peerPosition.updatedAt)}`;
  }

  return `Прочитано до ${formatDateTime(peerPosition.updatedAt)}`;
}

function describeReadStatus(readState: DirectChatReadState | null): string {
  if (!readState?.peerPosition) {
    return "Без видимого read state";
  }

  return `Прочитано ${formatDateTime(readState.peerPosition.updatedAt)}`;
}

function describeTypingStatus(typingState: DirectChatTypingState | null): string {
  if (!typingState?.peerTyping) {
    return "Не печатает";
  }

  return "Печатает...";
}

function describePresenceStatus(presenceState: DirectChatPresenceState | null): string {
  if (!presenceState?.peerPresence) {
    return "Нет видимого presence";
  }

  return `В сети · ${formatDateTime(presenceState.peerPresence.heartbeatAt)}`;
}

function describeDirectProfileSummary(profile: Profile | null): string {
  if (profile === null) {
    return "Карточка контакта использует уже доступные данные чата и догружает people snapshot только при открытии info mode.";
  }
  if (profile.statusText && profile.statusText.trim() !== "") {
    return profile.statusText;
  }
  if (profile.bio && profile.bio.trim() !== "") {
    return profile.bio;
  }

  return describeDirectProfileLocation(profile);
}

function describeDirectProfileLocation(profile: Profile | null): string {
  if (profile === null) {
    return "Локация не загружена";
  }
  if (profile.city && profile.country) {
    return `${profile.city}, ${profile.country}`;
  }
  if (profile.city) {
    return profile.city;
  }
  if (profile.country) {
    return profile.country;
  }

  return "Не указана";
}

function resolveEncryptedDirectReplyTarget(
  entries: Map<string, EncryptedDirectMessageV2ProjectedMessageEntry>,
  messageId: string | null,
  currentUserId: string,
  fallbackPeerName: string,
): EncryptedReplyTargetDescriptor | null {
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
    authorLabel:
      target.senderUserId === currentUserId ? "Вы" : fallbackPeerName,
    previewText: describeEncryptedDirectComposerReplyTarget(target),
  };
}

function describeEncryptedDirectComposerReplyTarget(
  entry: EncryptedDirectMessageV2ProjectedMessageEntry,
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

function describeEncryptedPinnedPreview(
  entry: EncryptedDirectMessageV2ProjectedMessageEntry | null,
): string {
  if (entry === null) {
    return "Сообщение закреплено, но его содержимое пока недоступно в этом окне.";
  }
  if (entry.isTombstone) {
    return "Сообщение закреплено, но уже удалено для всех.";
  }

  return describeEncryptedDirectComposerReplyTarget(entry);
}

function describeEncryptedBootstrapSendHint(input: {
  chatSelected: boolean;
  composerText: string;
  encryptedAttachmentDraft: ReturnType<
    typeof useEncryptedMediaAttachmentDraft
  >["draft"];
  hasEncryptedReplyTarget: boolean;
  isEditingEncryptedMessage: boolean;
  cryptoRuntimeState: CryptoContextState;
}): string {
  if (!input.chatSelected) {
    return "Откройте чат, чтобы отправить сообщение.";
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
