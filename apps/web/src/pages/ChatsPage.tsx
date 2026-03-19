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
import { useAttachmentComposer } from "../attachments/useAttachmentComposer";
import { useAuth } from "../auth/useAuth";
import { createMarkdownPreview } from "../chats/createMarkdownPreview";
import { resolveChatsRouteSyncAction } from "../chats/route-sync";
import { SafeMessageMarkdown } from "../chats/SafeMessageMarkdown";
import { useChats } from "../chats/useChats";
import type {
  ChatUser,
  DirectChat,
  DirectChatMessage,
  DirectChatPresenceState,
  DirectChatReadState,
  DirectChatTypingState,
} from "../gateway/types";
import styles from "./ChatsPage.module.css";

export function ChatsPage() {
  const { state: authState, expireSession } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [composerText, setComposerText] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [pendingOpenAttachmentId, setPendingOpenAttachmentId] = useState<string | null>(null);
  const pendingPeerRef = useRef<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const sessionToken =
    authState.status === "authenticated" ? authState.token : "";
  const chats = useChats({
    enabled: authState.status === "authenticated",
    token: sessionToken,
    currentUserId: authState.status === "authenticated" ? authState.profile.id : "",
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

  const requestedChatId = searchParams.get("chat")?.trim() ?? "";
  const requestedPeerUserId = searchParams.get("peer")?.trim() ?? "";
  const isThreadRouteActive = requestedChatId !== "" || requestedPeerUserId !== "";
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

  if (authState.status !== "authenticated") {
    return null;
  }

  const selectedThread = isThreadRouteActive ? chats.state.thread : null;
  const selectedPeer =
    selectedThread !== null
      ? getPeerParticipant(selectedThread.chat, authState.profile.id)
      : null;
  const latestOwnMessageId =
    selectedThread !== null
      ? getLatestOwnMessageId(selectedThread.messages, authState.profile.id)
      : null;
  const pinnedMessages =
    selectedThread === null
      ? []
      : selectedThread.messages.filter((message) =>
          selectedThread.chat.pinnedMessageIds.includes(message.id) || message.pinned,
        );
  const uploadedAttachmentId = attachmentComposer.uploadedAttachmentId;
  const attachmentDraft = attachmentComposer.state.draft;
  const canSubmitComposer = canSubmitMessageComposer({
    text: composerText,
    uploadedAttachmentId,
    isUploading: attachmentComposer.isUploading,
  });

  async function submitComposer() {
    const normalizedText = normalizeComposerMessageText(composerText);
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
      normalizedText,
      uploadedAttachmentId === null ? [] : [uploadedAttachmentId],
    );
    if (success) {
      setComposerText("");
      if (uploadedAttachmentId !== null) {
        attachmentComposer.markSendSucceeded();
      }
      return;
    }

    if (uploadedAttachmentId !== null) {
      attachmentComposer.markSendFailed();
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
    setSearchParams({}, { replace: true });
    setComposerError(null);
    chats.clearFeedback();
  }

  async function handleAttachmentSelection(file: File | null) {
    if (file === null) {
      return;
    }

    setComposerError(null);
    chats.clearFeedback();
    await attachmentComposer.selectFile(file);
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
              attachment-only сообщениями, включая lazy inline preview для image attachments.
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
          <Metric label="Закреплено" value={pinnedMessages.length} />
        </div>

        {chats.state.notice && <div className={styles.notice}>{chats.state.notice}</div>}
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
              <div className={styles.threadLayout}>
                <section className={styles.threadHero}>
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
                        message="Отправьте первое сообщение: текст, текст с файлом или attachment-only. Для image attachments inline preview уже доступен, а остальной richer media rendering остаётся отдельным slice."
                      />
                    ) : (
                      selectedThread.messages.map((message) => {
                        const isOwn = message.senderUserId === authState.profile.id;
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
                            data-own={isOwn}
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
                                  {readLabel && (
                                    <span className={styles.statusBadge}>{readLabel}</span>
                                  )}
                                </div>
                              </div>

                              <div className={styles.messageBody}>
                                {message.tombstone ? (
                                  <p className={styles.tombstoneText}>Сообщение удалено для всех.</p>
                                ) : (
                                  <>
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
                                </div>
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
                        disabled={chats.state.isSendingMessage || attachmentComposer.isUploading}
                        onClick={() => {
                          attachmentInputRef.current?.click();
                        }}
                        type="button"
                      >
                        {attachmentDraft === null ? "Выбрать файл" : "Заменить файл"}
                      </button>
                      <span className={styles.attachmentHint}>
                        Single-file composer: можно отправить текст, текст + файл или только файл.
                      </span>
                    </div>

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

                    <label className={styles.field}>
                      <span>Текст сообщения</span>
                      <textarea
                        disabled={chats.state.isSendingMessage || attachmentComposer.isUploading}
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
                          !canSubmitComposer
                        }
                        type="submit"
                      >
                          {chats.state.isSendingMessage ? "Отправляем..." : "Отправить"}
                        </button>
                      </div>
                    </div>
                  </form>
                </section>
              </div>
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

function describePresenceStatus(presenceState: DirectChatPresenceState | null): string {
  if (!presenceState?.peerPresence) {
    return "Нет видимого presence";
  }

  return `В сети · ${formatDateTime(presenceState.peerPresence.heartbeatAt)}`;
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
