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
import { createMarkdownPreview } from "../chats/createMarkdownPreview";
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
  type DirectChatMessage,
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
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageText, setEditingMessageText] = useState("");
  const [editingEncryptedMessageId, setEditingEncryptedMessageId] = useState<string | null>(null);
  const [pendingOpenAttachmentId, setPendingOpenAttachmentId] = useState<string | null>(null);
  const [isSendingVoiceNote, setIsSendingVoiceNote] = useState(false);
  const [isSendingVideoNote, setIsSendingVideoNote] = useState(false);
  const [selectedReplyMessage, setSelectedReplyMessage] = useState<DirectChatMessage | null>(null);
  const [selectedEncryptedReplyMessageId, setSelectedEncryptedReplyMessageId] =
    useState<string | null>(null);
  const [searchJumpNotice, setSearchJumpNotice] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const pendingPeerRef = useRef<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
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
  const attachmentComposer = useAttachmentComposer({
    enabled: authState.status === "authenticated",
    token: sessionToken,
    scope:
      chats.state.thread?.chat.id
        ? {
            kind: "direct",
            id: chats.state.thread.chat.id,
          }
        : null,
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
  const discardVoiceNoteRecording = useEffectEvent(() => {
    voiceNoteRecorder.discardRecording();
  });
  const discardVideoNoteRecording = useEffectEvent(() => {
    videoNoteRecorder.discardRecording();
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
    setEditingMessageId(null);
    setEditingMessageText("");
    setEditingEncryptedMessageId(null);
    setSelectedReplyMessage(null);
    setSelectedEncryptedReplyMessageId(null);
    setSearchJumpNotice(null);
    setHighlightedMessageId(null);
    discardVoiceNoteRecording();
    discardVideoNoteRecording();
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

    if (requestedChatId !== "" && chats.state.thread.chat.id !== requestedChatId) {
      return;
    }

    if (searchJumpIntent.lane === "encrypted") {
      if (encryptedLane.status === "idle" || encryptedLane.status === "loading") {
        return;
      }

      if (encryptedLane.status !== "ready") {
        setSearchJumpNotice(
          encryptedLane.errorMessage ??
            "Encrypted search result нельзя открыть в этом browser profile: local crypto runtime или bounded lane недоступны.",
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
          "Найденное encrypted сообщение пока не попало в текущее локально загруженное окно direct lane. Deep history backfill в этом slice не реализован.",
        );
        setHighlightedMessageId(null);
        setSearchParams(clearSearchJumpParams(searchParams), { replace: true });
        return;
      }

      setSearchJumpNotice(null);
      setHighlightedMessageId(encryptedTarget.messageId);
      jumpToMessage(`encrypted-direct-message-${encryptedTarget.messageId}`);
      setSearchParams(clearSearchJumpParams(searchParams), { replace: true });
      return;
    }

    const targetMessage = findJumpTarget(chats.state.thread.messages, searchJumpIntent.messageId);
    if (targetMessage === null) {
      setSearchJumpNotice(
        "Найденное сообщение пока не попало в текущую загруженную историю direct chat. Переход ограничен последним загруженным окном сообщений.",
      );
      setHighlightedMessageId(null);
      setSearchParams(clearSearchJumpParams(searchParams), { replace: true });
      return;
    }

    setSearchJumpNotice(null);
    setHighlightedMessageId(targetMessage.id);
    jumpToMessage(`direct-message-${targetMessage.id}`);
    setSearchParams(clearSearchJumpParams(searchParams), { replace: true });
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
  const latestOwnMessageId =
    selectedThread !== null
      ? getLatestOwnMessageId(selectedThread.messages, currentUserId)
      : null;
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
  const encryptedFailureCount = encryptedLane.items.filter(
    (item) => item.kind === "failure",
  ).length;
  const uploadedAttachmentId = attachmentComposer.uploadedAttachmentId;
  const attachmentDraft = attachmentComposer.state.draft;
  const encryptedAttachmentDraft = encryptedMediaAttachmentDraft.draft;
  const uploadedEncryptedAttachmentDraft = encryptedMediaAttachmentDraft.uploadedDraft;
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
  const isSendingRecordedNote = isSendingVoiceNote || isSendingVideoNote;
  const canSubmitComposer = canSubmitMessageComposer({
    text: composerText,
    uploadedAttachmentId,
    isUploading: attachmentComposer.isUploading,
  });
  const canPickAttachment =
    !chats.state.isSendingMessage &&
    !isSendingRecordedNote &&
    !attachmentComposer.isUploading &&
    !encryptedMediaAttachmentDraft.isUploading &&
    !hasPendingVoiceNote &&
    !hasPendingVideoNote;
  const canPickEncryptedAttachment =
    !chats.state.isSendingMessage &&
    !isSendingRecordedNote &&
    !attachmentComposer.isUploading &&
    !encryptedMediaAttachmentDraft.isUploading &&
    attachmentDraft === null &&
    uploadedAttachmentId === null &&
    !hasPendingVoiceNote &&
    !hasPendingVideoNote;
  const canRecordVoiceNote =
    !chats.state.isSendingMessage &&
    !isSendingRecordedNote &&
    !attachmentComposer.isUploading &&
    !encryptedMediaAttachmentDraft.isUploading &&
    attachmentDraft === null &&
    encryptedAttachmentDraft === null &&
    !hasPendingVideoNote;
  const canRecordVideoNote =
    !chats.state.isSendingMessage &&
    !isSendingRecordedNote &&
    !attachmentComposer.isUploading &&
    !encryptedMediaAttachmentDraft.isUploading &&
    attachmentDraft === null &&
    encryptedAttachmentDraft === null &&
    !hasPendingVoiceNote;
  const canSendEncryptedDirectMessageV2 =
    selectedThread !== null &&
    !chats.state.isSendingMessage &&
    !cryptoRuntime.state.isActionPending &&
    !isSendingRecordedNote &&
    !attachmentComposer.isUploading &&
    !encryptedMediaAttachmentDraft.isUploading &&
    attachmentDraft === null &&
    uploadedAttachmentId === null &&
    (normalizeComposerMessageText(composerText) !== "" ||
      uploadedEncryptedAttachmentDraft !== null);
  const encryptedSendHint = describeEncryptedBootstrapSendHint({
    chatSelected: selectedThread !== null,
    composerText,
    legacyAttachmentDraftPresent: attachmentDraft !== null || uploadedAttachmentId !== null,
    encryptedAttachmentDraft,
    hasPendingVoiceNote,
    hasPendingVideoNote,
    hasLegacyReplyTarget: selectedReplyMessage !== null,
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
    setMobileWindowContentMode("thread");
  }, [requestedChatId, requestedPeerUserId]);

  if (authState.status !== "authenticated") {
    return null;
  }

  async function submitComposer() {
    if (selectedEncryptedReplyEntry !== null || editingEncryptedEntry !== null) {
      setComposerError(
        "Текущий composer находится в encrypted режиме. Для plaintext send сначала снимите encrypted reply/edit.",
      );
      chats.clearFeedback();
      return;
    }

    if (encryptedAttachmentDraft !== null || uploadedEncryptedAttachmentDraft !== null) {
      setComposerError(
        "Текущий encrypted media draft отправляется только через кнопку Encrypted DM v2.",
      );
      chats.clearFeedback();
      return;
    }

    if (!canSubmitComposer) {
      setComposerError(
        attachmentComposer.isUploading
          ? "Дождитесь завершения загрузки файла, прежде чем отправлять сообщение."
          : "Добавьте текст сообщения или готовое вложение.",
      );
      chats.clearFeedback();
      return;
    }

    setComposerError(null);
    const success = await chats.sendMessage(
      normalizeComposerMessageText(composerText),
      uploadedAttachmentId === null ? [] : [uploadedAttachmentId],
      selectedReplyMessage?.id ?? null,
    );
    if (success) {
      setComposerText("");
      setSelectedReplyMessage(null);
      if (uploadedAttachmentId !== null) {
        attachmentComposer.markSendSucceeded();
      }
      return;
    }

    if (uploadedAttachmentId !== null) {
      attachmentComposer.markSendFailed();
    }
  }

  async function handleEncryptedDirectMessageV2Send() {
    if (selectedThread === null) {
      return;
    }

    if (attachmentDraft !== null || uploadedAttachmentId !== null) {
      setComposerError(
        "Legacy attachment composer не подключён к encrypted DM v2 send. Используйте отдельный encrypted media draft.",
      );
      chats.clearFeedback();
      return;
    }
    if (selectedReplyMessage !== null) {
      setComposerError(
        "Encrypted DM v2 reply в этом slice работает только по encrypted message id внутри local encrypted lane.",
      );
      chats.clearFeedback();
      return;
    }
    if (hasPendingVoiceNote || hasPendingVideoNote || isSendingRecordedNote) {
      setComposerError(
        "Encrypted DM v2 bootstrap send пока не расширяется на voice/video notes.",
      );
      chats.clearFeedback();
      return;
    }

    const normalizedText = normalizeComposerMessageText(composerText);
    if (normalizedText === "" && uploadedEncryptedAttachmentDraft === null) {
      setComposerError(
        "Добавьте текст или готовый encrypted attachment для encrypted DM v2 send.",
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
      setSelectedReplyMessage(null);
      setSelectedEncryptedReplyMessageId(null);
      setEditingEncryptedMessageId(null);
      encryptedMediaAttachmentDraft.markSendSucceeded();
    } catch (error) {
      encryptedMediaAttachmentDraft.markSendFailed();
      setComposerError(
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : "Не удалось отправить encrypted DM v2 через crypto runtime.",
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
          : "Не удалось опубликовать encrypted tombstone.",
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
            ? "Не удалось снять encrypted pin."
            : "Не удалось закрепить encrypted message.",
      );
    }
  }

  async function handleSendVoiceNote() {
    const voiceNoteDraft = voiceNoteRecorder.state.draft;
    if (
      voiceNoteDraft === null ||
      chats.state.thread === null ||
      chats.state.isSendingMessage ||
      isSendingRecordedNote ||
      attachmentComposer.isUploading ||
      encryptedMediaAttachmentDraft.isUploading
    ) {
      return;
    }

    setIsSendingVoiceNote(true);
    setComposerError(null);
    chats.clearFeedback();

    const recordedFile = voiceNoteDraft.file;
    voiceNoteRecorder.discardRecording();

    try {
      const uploadedAttachment = await attachmentComposer.selectFile(recordedFile);
      if (uploadedAttachment === null) {
        return;
      }

      const success = await chats.sendMessage(
        normalizeComposerMessageText(composerText),
        [uploadedAttachment.id],
        selectedReplyMessage?.id ?? null,
      );

      if (success) {
        setComposerText("");
        setSelectedReplyMessage(null);
        attachmentComposer.markSendSucceeded();
        return;
      }

      attachmentComposer.markSendFailed();
    } finally {
      setIsSendingVoiceNote(false);
    }
  }

  async function handleSendVideoNote() {
    const videoNoteDraft = videoNoteRecorder.state.draft;
    if (
      videoNoteDraft === null ||
      chats.state.thread === null ||
      chats.state.isSendingMessage ||
      isSendingRecordedNote ||
      attachmentComposer.isUploading ||
      encryptedMediaAttachmentDraft.isUploading
    ) {
      return;
    }

    setIsSendingVideoNote(true);
    setComposerError(null);
    chats.clearFeedback();

    const recordedFile = videoNoteDraft.file;
    videoNoteRecorder.discardRecording();

    try {
      const uploadedAttachment = await attachmentComposer.selectFile(recordedFile);
      if (uploadedAttachment === null) {
        return;
      }

      const success = await chats.sendMessage(
        normalizeComposerMessageText(composerText),
        [uploadedAttachment.id],
        selectedReplyMessage?.id ?? null,
      );

      if (success) {
        setComposerText("");
        setSelectedReplyMessage(null);
        attachmentComposer.markSendSucceeded();
        return;
      }

      attachmentComposer.markSendFailed();
    } finally {
      setIsSendingVideoNote(false);
    }
  }

  async function handleComposerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitComposer();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void submitComposer();
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

  async function handleAttachmentSelection(file: File | null) {
    if (file === null) {
      return;
    }

    setComposerError(null);
    chats.clearFeedback();
    await attachmentComposer.selectFile(file);
  }

  async function handleEncryptedAttachmentSelection(file: File | null) {
    if (file === null) {
      return;
    }

    setComposerError(null);
    chats.clearFeedback();
    await encryptedMediaAttachmentDraft.selectFile(file);
  }

  async function handleSaveMessageEdit(messageId: string) {
    const normalizedText = normalizeComposerMessageText(editingMessageText);
    if (normalizedText === "") {
      setComposerError("Отредактированное сообщение не может быть полностью пустым.");
      chats.clearFeedback();
      return;
    }

    setComposerError(null);
    const success = await chats.editMessage(messageId, normalizedText);
    if (!success) {
      return;
    }

    setEditingMessageId(null);
    setEditingMessageText("");
  }

  async function handleOpenAttachment(attachmentId: string) {
    setPendingOpenAttachmentId(attachmentId);
    setComposerError(null);

    try {
      await openAttachmentInNewTab(sessionToken, attachmentId);
    } catch (error) {
      setComposerError(
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
    setComposerError(null);

    try {
      await downloadAttachment(sessionToken, attachmentId, fileName);
    } catch (error) {
      setComposerError(
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : "Не удалось скачать вложение.",
      );
    } finally {
      setPendingOpenAttachmentId(null);
    }
  }

  return (
    <div className={styles.layout}>
      <section className={styles.heroCard}>
        <div className={styles.heroHeader}>
          <div>
            <p className={styles.cardLabel}>Chats</p>
            <h1 className={styles.title}>Личные чаты AeroChat</h1>
            <p className={styles.subtitle}>
              Лёгкий direct chat shell остаётся gateway-only, уже поднимает bounded realtime
              transport foundation и single-file attachment flow с text-only, text + file и
              attachment-only сообщениями, включая lazy inline preview для image/audio/video
              attachments.
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
          <Metric label="В thread" value={selectedThread?.messages.length ?? 0} />
          <Metric label="Encrypted unread" value={selectedThread?.chat.encryptedUnreadCount ?? 0} />
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

      <div className={styles.workspace}>
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
                              Encrypted unread: {chat.encryptedUnreadCount}
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

        <section
          className={styles.threadPane}
          data-mobile-hidden={!isThreadRouteActive && chats.state.chats.length > 0}
        >
          <div className={styles.sectionCard}>
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

            {!isThreadRouteActive && chats.state.status === "ready" && chats.state.chats.length > 0 && (
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
                        <button
                          className={styles.secondaryButton}
                          onClick={handleBackToChatsList}
                          type="button"
                        >
                          Назад к списку
                        </button>
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
                        label={describeReadStatus(selectedThread.readState)}
                        tone={selectedThread.readState?.peerPosition ? "accent" : "neutral"}
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
                      label={describeReadStatus(selectedThread.readState)}
                      tone={selectedThread.readState?.peerPosition ? "accent" : "neutral"}
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

                {pinnedMessages.length > 0 && (
                  <section className={styles.pinnedStrip}>
                    <div className={styles.blockHeader}>
                      <div>
                        <p className={styles.cardLabel}>Pinned</p>
                        <h3 className={styles.blockTitle}>Закреплённые сообщения</h3>
                      </div>
                      <span className={styles.metaTag}>{pinnedMessages.length}</span>
                    </div>

                    <div className={styles.pinnedList}>
                      {pinnedMessages.map((message) => {
                        const isOwn = message.senderUserId === authState.profile.id;

                        return (
                          <article key={message.id} className={styles.pinnedCard}>
                            <div className={styles.pinnedHeader}>
                              <strong>{isOwn ? "Вы" : selectedPeer?.nickname ?? "Собеседник"}</strong>
                              <span className={styles.pinnedMeta}>
                                {formatDateTime(message.createdAt)}
                              </span>
                            </div>
                            <p className={styles.pinnedText}>
                              {describeMessagePreview(message)}
                            </p>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                )}

                {selectedThread.chat.encryptedPinnedMessageIds.length > 0 && (
                  <section className={styles.pinnedStrip}>
                    <div className={styles.blockHeader}>
                      <div>
                        <p className={styles.cardLabel}>Encrypted pinned</p>
                        <h3 className={styles.blockTitle}>Закрепления encrypted DM v2</h3>
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
                                ? "Encrypted message"
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
                      <p className={styles.cardLabel}>Encrypted DM v2</p>
                      <h3 className={styles.blockTitle}>Локальная decrypted projection</h3>
                    </div>
                    <div className={styles.headerActions}>
                      {selectedThread.chat.encryptedUnreadCount > 0 && (
                        <span className={styles.statusBadge} data-tone="accent">
                          Encrypted unread: {selectedThread.chat.encryptedUnreadCount}
                        </span>
                      )}
                      <span className={styles.metaTag}>
                        {encryptedLane.status === "ready"
                          ? `${encryptedMessageCount} msg / ${encryptedFailureCount} fail`
                          : encryptedLane.status === "unavailable"
                            ? "Недоступно"
                            : "Подготавливаем"}
                      </span>
                    </div>
                  </div>

                  <p className={styles.encryptedLaneDescription}>
                    Эта секция показывает только client-side decrypted projection из opaque
                    encrypted envelopes для текущего local crypto-device. Legacy plaintext
                    timeline остаётся ниже без скрытого merge.
                  </p>

                  <div className={styles.messagesList}>
                    {encryptedLane.status === "loading" && (
                      <StateCard
                        title="Готовим encrypted DM v2"
                        message="Загружаем opaque envelopes из storage и пропускаем их через crypto runtime worker."
                      />
                    )}

                    {encryptedLane.status === "unavailable" && (
                      <StateCard
                        title="Encrypted DM v2 недоступен"
                        message={
                          encryptedLane.errorMessage ??
                          "Для этого browser profile encrypted DM v2 local projection пока недоступен."
                        }
                      />
                    )}

                    {encryptedLane.status === "error" && (
                      <StateCard
                        title="Encrypted DM v2 не загрузился"
                        message={
                          encryptedLane.errorMessage ??
                          "Не удалось собрать local projection для encrypted DM v2."
                        }
                        tone="error"
                      />
                    )}

                    {encryptedLane.status === "ready" &&
                      encryptedLane.items.length === 0 && (
                        <StateCard
                          title="Encrypted envelopes пока не видны"
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
                                  setSelectedReplyMessage(null);
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
                                  setSelectedReplyMessage(null);
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
                      <p className={styles.cardLabel}>Timeline</p>
                      <h3 className={styles.blockTitle}>Сообщения</h3>
                    </div>
                    <span className={styles.metaTag}>
                      {selectedThread.messages.length === 0
                        ? "Пусто"
                        : `${selectedThread.messages.length} шт.`}
                    </span>
                  </div>

                  <div className={styles.messagesList}>
                    {selectedThread.messages.length === 0 ? (
                      <StateCard
                        title="Сообщений пока нет"
                        message="Отправьте первое сообщение: текст, текст с файлом или attachment-only. Для image/audio/video attachments inline preview уже доступен, а media processing pipeline остаётся отдельным slice."
                      />
                    ) : (
                      selectedThread.messages.map((message) => {
                        const isOwn = message.senderUserId === authState.profile.id;
                        const canEdit = isDirectMessageEditable(message, authState.profile.id);
                        const isEditing = editingMessageId === message.id;
                        const hasMessageText = hasRenderableMessageText(message.text);
                        const hasAttachments = message.attachments.length > 0;
                        const pendingLabel = chats.state.pendingMessageActions[message.id] ?? null;
                        const readLabel =
                          message.id === latestOwnMessageId
                            ? describeOwnMessageReadLabel(message, selectedThread.readState)
                            : null;

                        return (
                          <article
                            key={message.id}
                            className={styles.messageRow}
                            id={`direct-message-${message.id}`}
                            data-own={isOwn}
                            data-search-target={highlightedMessageId === message.id}
                          >
                            <div className={styles.messageBubble} data-own={isOwn}>
                              <div className={styles.messageHeader}>
                                <div>
                                  <p className={styles.messageAuthor}>
                                    {isOwn ? "Вы" : selectedPeer?.nickname ?? "Собеседник"}
                                  </p>
                                  <p className={styles.messageMeta}>
                                    {formatDateTime(message.createdAt)}
                                  </p>
                                </div>

                                <div className={styles.messageBadges}>
                                  {message.pinned && (
                                    <span className={styles.statusBadge} data-tone="accent">
                                      Закреплено
                                    </span>
                                  )}
                                  {message.editedAt && (
                                    <span className={styles.statusBadge}>Изменено</span>
                                  )}
                                  {readLabel && (
                                    <span className={styles.statusBadge}>{readLabel}</span>
                                  )}
                                </div>
                              </div>

                              <div className={styles.messageBody}>
                                {message.tombstone ? (
                                  <p className={styles.tombstoneText}>Сообщение удалено для всех.</p>
                                ) : isEditing ? (
                                  <>
                                    <label className={`${styles.field} ${styles.editField}`}>
                                      <span>Текст сообщения</span>
                                      <textarea
                                        disabled={pendingLabel !== null}
                                        maxLength={4000}
                                        onChange={(event) => {
                                          setEditingMessageText(event.target.value);
                                          setComposerError(null);
                                          chats.clearFeedback();
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

                                    {hasAttachments && (
                                      <MessageAttachmentList
                                        accessToken={sessionToken}
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
                                  </>
                                ) : (
                                  <>
                                    {message.replyPreview && (
                                      <button
                                        className={styles.replyPreviewCard}
                                        onClick={() => {
                                          jumpToMessage(`direct-message-${message.replyPreview?.messageId ?? ""}`);
                                        }}
                                        type="button"
                                      >
                                        <span className={styles.replyPreviewAuthor}>
                                          {describeReplyPreviewAuthor(
                                            message.replyPreview,
                                            authState.profile.id,
                                            selectedPeer?.nickname ?? "Собеседник",
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

                                    {hasAttachments && (
                                      <MessageAttachmentList
                                        accessToken={sessionToken}
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
                                  </>
                                )}
                              </div>

                              {!message.tombstone && (
                                <div className={styles.actions}>
                                  {isEditing ? (
                                    <>
                                      <button
                                        className={styles.primaryButton}
                                        disabled={pendingLabel !== null}
                                        onClick={() => {
                                          void handleSaveMessageEdit(message.id);
                                        }}
                                        type="button"
                                      >
                                        Сохранить
                                      </button>
                                      <button
                                        className={styles.ghostButton}
                                        disabled={pendingLabel !== null}
                                        onClick={() => {
                                          setEditingMessageId(null);
                                          setEditingMessageText("");
                                          setComposerError(null);
                                          chats.clearFeedback();
                                        }}
                                        type="button"
                                      >
                                        Отмена
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        className={styles.ghostButton}
                                        disabled={pendingLabel !== null}
                                        onClick={() => {
                                          void (message.pinned
                                            ? chats.unpinMessage(message.id)
                                            : chats.pinMessage(message.id));
                                        }}
                                        type="button"
                                      >
                                        {message.pinned ? "Снять pin" : "Закрепить"}
                                      </button>

                                      <button
                                        className={styles.ghostButton}
                                        disabled={pendingLabel !== null}
                                        onClick={() => {
                                          setSelectedEncryptedReplyMessageId(null);
                                          setEditingEncryptedMessageId(null);
                                          setSelectedReplyMessage(message);
                                          setComposerError(null);
                                          chats.clearFeedback();
                                        }}
                                        type="button"
                                      >
                                        Ответить
                                      </button>

                                      {canEdit && (
                                        <button
                                          className={styles.ghostButton}
                                          disabled={pendingLabel !== null}
                                          onClick={() => {
                                            setSelectedEncryptedReplyMessageId(null);
                                            setEditingEncryptedMessageId(null);
                                            setEditingMessageId(message.id);
                                            setEditingMessageText(message.text?.text ?? "");
                                            setComposerError(null);
                                            chats.clearFeedback();
                                          }}
                                          type="button"
                                        >
                                          Редактировать
                                        </button>
                                      )}

                                      {isOwn && (
                                        <button
                                          className={styles.ghostButton}
                                          disabled={pendingLabel !== null}
                                          onClick={() => {
                                            void chats.deleteMessageForEveryone(message.id);
                                          }}
                                          type="button"
                                        >
                                          Удалить для всех
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}

                              {!message.tombstone && message.editedAt && (
                                <p className={styles.editMeta}>
                                  Последнее редактирование: {formatDateTime(message.editedAt)}
                                </p>
                              )}

                              {pendingLabel && <p className={styles.pendingText}>{pendingLabel}</p>}
                            </div>
                          </article>
                        );
                      })
                    )}
                  </div>
                </section>

                <section className={styles.composerCard}>
                  <div className={styles.blockHeader}>
                    <div>
                      <p className={styles.cardLabel}>Composer</p>
                      <h3 className={styles.blockTitle}>Новое сообщение</h3>
                    </div>
                    <span className={styles.composerHint}>
                      Enter отправляет, Shift+Enter переносит строку
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
                          Отменить encrypted reply
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
                          Отменить encrypted edit
                        </button>
                      </div>
                    )}

                    {selectedReplyMessage && (
                      <div className={styles.replyComposerCard}>
                        <div>
                          <p className={styles.replyPreviewAuthor}>
                            Ответ на {selectedReplyMessage.senderUserId === authState.profile.id ? "ваше сообщение" : selectedPeer?.nickname ?? "сообщение собеседника"}
                          </p>
                          <p className={styles.replyPreviewText}>
                            {describeDirectComposerReplyTarget(
                              selectedReplyMessage,
                              authState.profile.id,
                            )}
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
                        disabled={!canPickAttachment}
                        onClick={() => {
                          attachmentInputRef.current?.click();
                        }}
                        type="button"
                      >
                        {attachmentDraft === null ? "Выбрать файл" : "Заменить файл"}
                      </button>
                      <button
                        className={styles.secondaryButton}
                        disabled={!canPickEncryptedAttachment}
                        onClick={() => {
                          encryptedAttachmentInputRef.current?.click();
                        }}
                        type="button"
                      >
                        {encryptedAttachmentDraft === null
                          ? "Выбрать encrypted файл"
                          : "Заменить encrypted файл"}
                      </button>
                      <span className={styles.attachmentHint}>
                        Single-file composer: можно выбрать файл, записать голосовую или видео
                        заметку, отправить текст + attachment или только attachment.
                      </span>
                    </div>

                    <VoiceNoteRecorderPanel
                      discardDisabled={chats.state.isSendingMessage || isSendingRecordedNote}
                      isSending={isSendingVoiceNote}
                      onDiscard={() => {
                        voiceNoteRecorder.discardRecording();
                      }}
                      onSend={() => {
                        void handleSendVoiceNote();
                      }}
                      onStart={() => {
                        void voiceNoteRecorder.startRecording();
                      }}
                      onStop={() => {
                        voiceNoteRecorder.stopRecording();
                      }}
                      sendDisabled={
                        chats.state.isSendingMessage ||
                        isSendingRecordedNote ||
                        attachmentComposer.isUploading ||
                        encryptedMediaAttachmentDraft.isUploading
                      }
                      startDisabled={!canRecordVoiceNote}
                      state={voiceNoteRecorder.state}
                      stopDisabled={isSendingRecordedNote}
                    />

                    <VideoNoteRecorderPanel
                      discardDisabled={chats.state.isSendingMessage || isSendingRecordedNote}
                      isSending={isSendingVideoNote}
                      onDiscard={() => {
                        videoNoteRecorder.discardRecording();
                      }}
                      onSend={() => {
                        void handleSendVideoNote();
                      }}
                      onStart={() => {
                        void videoNoteRecorder.startRecording();
                      }}
                      onStop={() => {
                        videoNoteRecorder.stopRecording();
                      }}
                      sendDisabled={
                        chats.state.isSendingMessage ||
                        isSendingRecordedNote ||
                        attachmentComposer.isUploading ||
                        encryptedMediaAttachmentDraft.isUploading
                      }
                      startDisabled={!canRecordVideoNote}
                      state={videoNoteRecorder.state}
                      stopDisabled={isSendingRecordedNote}
                    />

                    {attachmentDraft && (
                      <div className={styles.attachmentDraftCard}>
                        <div>
                          <p className={styles.attachmentDraftTitle}>{attachmentDraft.fileName}</p>
                          <p className={styles.attachmentDraftMeta}>
                            {formatAttachmentSize(attachmentDraft.sizeBytes)} •{" "}
                            {describeAttachmentMimeType(attachmentDraft.mimeType)}
                          </p>
                          {attachmentDraft.status === "uploading" && (
                            <p className={styles.attachmentDraftStatus}>
                              Загружаем: {attachmentDraft.progress}%
                            </p>
                          )}
                          {attachmentDraft.status === "preparing" && (
                            <p className={styles.attachmentDraftStatus}>
                              Подготавливаем upload intent...
                            </p>
                          )}
                          {attachmentDraft.status === "uploaded" && (
                            <p className={styles.attachmentDraftStatus}>
                              Файл загружен и будет прикреплён к следующему сообщению.
                            </p>
                          )}
                          {attachmentDraft.status === "error" && (
                            <p className={styles.attachmentDraftError}>
                              {attachmentDraft.errorMessage ?? "Не удалось загрузить файл."}
                            </p>
                          )}
                        </div>

                        <div className={styles.attachmentDraftActions}>
                          {attachmentDraft.status === "error" && (
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

                    {encryptedAttachmentDraft && (
                      <div className={styles.attachmentDraftCard}>
                        <div>
                          <p className={styles.attachmentDraftTitle}>
                            {encryptedAttachmentDraft.fileName}
                          </p>
                          <p className={styles.attachmentDraftMeta}>
                            {formatAttachmentSize(
                              encryptedAttachmentDraft.plaintextSizeBytes,
                            )}{" "}
                            plaintext •{" "}
                            {encryptedAttachmentDraft.ciphertextSizeBytes > 0 &&
                              `${formatAttachmentSize(
                                encryptedAttachmentDraft.ciphertextSizeBytes,
                              )} ciphertext • `}
                            {describeAttachmentMimeType(encryptedAttachmentDraft.mimeType)}
                          </p>
                          {encryptedAttachmentDraft.status === "preparing" && (
                            <p className={styles.attachmentDraftStatus}>
                              Шифруем файл внутри crypto runtime перед upload...
                            </p>
                          )}
                          {encryptedAttachmentDraft.status === "uploading" && (
                            <p className={styles.attachmentDraftStatus}>
                              Загружаем ciphertext blob: {encryptedAttachmentDraft.progress}%
                            </p>
                          )}
                          {encryptedAttachmentDraft.status === "uploaded" && (
                            <p className={styles.attachmentDraftStatus}>
                              Ciphertext blob загружен. Descriptor будет отправлен только через
                              Encrypted DM v2.
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
                          isSendingVoiceNote ||
                          attachmentComposer.isUploading ||
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
                          className={styles.primaryButton}
                          disabled={
                            chats.state.isSendingMessage ||
                            isSendingVoiceNote ||
                            isSendingVideoNote ||
                            encryptedAttachmentDraft !== null ||
                            !canSubmitComposer
                          }
                          type="submit"
                        >
                          {chats.state.isSendingMessage ? "Отправляем..." : "Отправить"}
                        </button>
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
                              ? "Сохранить encrypted edit"
                              : "Encrypted DM v2"}
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
            <p className={styles.tombstoneText}>Encrypted сообщение удалено для всех.</p>
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
                  Payload расшифровался, но renderable content для этого slice отсутствует.
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
                {input.isPinned ? "Снять encrypted pin" : "Закрепить"}
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
            ? ` • tombstone ${formatDateTime(input.item.deletedAt)}`
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

function getLatestOwnMessageId(messages: DirectChatMessage[], currentUserId: string): string | null {
  const latestOwnMessage = [...messages]
    .reverse()
    .find((message) => message.senderUserId === currentUserId && message.tombstone === null);

  return latestOwnMessage?.id ?? null;
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

function describeMessagePreview(message: DirectChatMessage): string {
  if (message.tombstone) {
    return "Удалённое сообщение";
  }

  const text = createMarkdownPreview(message.text?.text ?? "");
  if (text === "") {
    if (message.attachments.length === 1) {
      return "Вложение без текста";
    }
    if (message.attachments.length > 1) {
      return `Вложения без текста: ${message.attachments.length}`;
    }
    return "Текст недоступен";
  }

  return text.length > 92 ? `${text.slice(0, 89)}...` : text;
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

function isDirectMessageEditable(
  message: DirectChatMessage,
  currentUserId: string,
): boolean {
  return (
    message.senderUserId === currentUserId &&
    message.tombstone === null &&
    message.text !== null
  );
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

function describeOwnMessageReadLabel(
  message: DirectChatMessage,
  readState: DirectChatReadState | null,
): string | null {
  const peerPosition = readState?.peerPosition;
  if (!peerPosition) {
    return null;
  }

  const messageDate = new Date(message.createdAt);
  const readDate = new Date(peerPosition.messageCreatedAt);
  if (Number.isNaN(messageDate.getTime()) || Number.isNaN(readDate.getTime())) {
    return "Прочитано";
  }

  if (messageDate.getTime() <= readDate.getTime()) {
    return "Прочитано";
  }

  return null;
}

function describeReplyPreviewAuthor(
  preview: DirectChatMessage["replyPreview"],
  currentUserId: string,
  fallbackPeerName: string,
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
  return preview.author.nickname || fallbackPeerName;
}

function describeReplyPreviewText(preview: DirectChatMessage["replyPreview"]): string {
  if (!preview) {
    return "";
  }
  if (preview.isDeleted) {
    return "Сообщение удалено для всех.";
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

function describeDirectComposerReplyTarget(
  message: DirectChatMessage,
  currentUserId: string,
): string {
  if (message.tombstone) {
    return "Сообщение удалено для всех.";
  }
  const textPreview = createMarkdownPreview(message.text?.text ?? "");
  if (textPreview !== "") {
    return textPreview.length > 140 ? `${textPreview.slice(0, 137)}...` : textPreview;
  }
  if (message.attachments.length > 0) {
    return message.attachments.length === 1
      ? "Вложение"
      : `Вложения: ${message.attachments.length}`;
  }
  return message.senderUserId === currentUserId ? "Ваше сообщение" : "Сообщение собеседника";
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
      authorLabel: "Недоступное encrypted сообщение",
      previewText: "Reply target пока не разрешён в текущем локальном bounded окне.",
    };
  }

  if (target.isTombstone) {
    return {
      messageId: target.messageId,
      authorLabel: "Удалённое encrypted сообщение",
      previewText: "Сообщение удалено для всех локальным tombstone.",
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
      ? "Encrypted вложение"
      : `Encrypted вложения: ${entry.attachments.length}`;
  }

  return "Encrypted сообщение без renderable content.";
}

function describeEncryptedPinnedPreview(
  entry: EncryptedDirectMessageV2ProjectedMessageEntry | null,
): string {
  if (entry === null) {
    return "Серверный pin уже сохранён, но содержимое сообщения ещё не разрешено локальной encrypted projection.";
  }
  if (entry.isTombstone) {
    return "Сообщение закреплено по logical id, но его текущее состояние tombstone.";
  }

  return describeEncryptedDirectComposerReplyTarget(entry);
}

function describeEncryptedBootstrapSendHint(input: {
  chatSelected: boolean;
  composerText: string;
  legacyAttachmentDraftPresent: boolean;
  encryptedAttachmentDraft: ReturnType<
    typeof useEncryptedMediaAttachmentDraft
  >["draft"];
  hasPendingVoiceNote: boolean;
  hasPendingVideoNote: boolean;
  hasLegacyReplyTarget: boolean;
  hasEncryptedReplyTarget: boolean;
  isEditingEncryptedMessage: boolean;
  cryptoRuntimeState: CryptoContextState;
}): string {
  if (!input.chatSelected) {
    return "Encrypted DM v2 bootstrap send доступен только внутри открытого direct chat.";
  }
  if (input.cryptoRuntimeState.status !== "ready") {
    return "Crypto runtime ещё не готов. Encrypted DM v2 bootstrap send ждёт worker bootstrap.";
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
      "Для encrypted DM v2 bootstrap send нужен active local crypto-device."
    );
  }
  if (input.legacyAttachmentDraftPresent) {
    return "Legacy attachment draft отправляется только обычным composer path. Для encrypted media используйте отдельный encrypted draft.";
  }
  if (input.encryptedAttachmentDraft?.status === "preparing") {
    return "Файл шифруется внутри crypto runtime перед presigned upload.";
  }
  if (input.encryptedAttachmentDraft?.status === "uploading") {
    return "Загружаем ciphertext blob в object storage. Descriptor уйдёт позже внутри encrypted DM v2 payload.";
  }
  if (input.encryptedAttachmentDraft?.status === "error") {
    return "Encrypted media draft не готов: исправьте ошибку upload и повторите.";
  }
  if (input.hasLegacyReplyTarget) {
    return "Plaintext reply target не используется внутри encrypted DM v2 slice. Выберите reply в encrypted lane.";
  }
  if (input.isEditingEncryptedMessage) {
    return "Кнопка Encrypted DM v2 опубликует новую opaque edit revision для выбранного logical message id.";
  }
  if (input.hasEncryptedReplyTarget) {
    return "Reply reference уйдёт только внутри ciphertext payload. Preview строится локально после decrypt без server-side plaintext quote.";
  }
  if (input.hasPendingVoiceNote || input.hasPendingVideoNote) {
    return "Voice/video note path остаётся legacy attachment flow и не входит в encrypted bootstrap send.";
  }
  if (
    normalizeComposerMessageText(input.composerText) === "" &&
    input.encryptedAttachmentDraft?.status !== "uploaded"
  ) {
    return "Введите текст или подготовьте encrypted attachment, чтобы отправить bounded encrypted DM v2 envelope.";
  }
  if (input.encryptedAttachmentDraft?.status === "uploaded") {
    return "Ciphertext blob уже загружен. Кнопка Encrypted DM v2 отправит attachment descriptor внутри opaque message payload без plaintext metadata на сервере.";
  }

  return "Отдельное явное действие: worker соберёт encrypted DM v2 envelope и отправит opaque deliveries без plaintext shadow write.";
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
