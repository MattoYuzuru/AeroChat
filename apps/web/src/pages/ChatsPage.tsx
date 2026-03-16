import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
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
  const pendingPeerRef = useRef<string | null>(null);
  const chats = useChats({
    enabled: authState.status === "authenticated",
    token: authState.status === "authenticated" ? authState.token : "",
    onUnauthenticated: () => expireSession(),
  });

  const requestedChatId = searchParams.get("chat")?.trim() ?? "";
  const requestedPeerUserId = searchParams.get("peer")?.trim() ?? "";

  useEffect(() => {
    if (authState.status !== "authenticated" || chats.state.status !== "ready") {
      return;
    }

    if (requestedChatId !== "") {
      if (chats.state.selectedChatId !== requestedChatId) {
        void chats.openChat(requestedChatId);
      }
      return;
    }

    if (requestedPeerUserId !== "") {
      if (pendingPeerRef.current === requestedPeerUserId) {
        return;
      }

      pendingPeerRef.current = requestedPeerUserId;
      void chats.ensureDirectChat(requestedPeerUserId).then((chatId) => {
        if (!chatId) {
          pendingPeerRef.current = null;
          return;
        }

        setSearchParams({ chat: chatId }, { replace: true });
      });
      return;
    }

    pendingPeerRef.current = null;
    const [firstChat] = chats.state.chats;
    if (firstChat && chats.state.selectedChatId === null) {
      setSearchParams({ chat: firstChat.id }, { replace: true });
    }
  }, [
    authState.status,
    chats,
    requestedChatId,
    requestedPeerUserId,
    setSearchParams,
  ]);

  if (authState.status !== "authenticated") {
    return null;
  }

  const selectedThread = chats.state.thread;
  const selectedPeer =
    selectedThread !== null
      ? getPeerParticipant(selectedThread.chat, authState.profile.id)
      : null;
  const pinnedMessages =
    selectedThread === null
      ? []
      : selectedThread.messages.filter((message) =>
          selectedThread.chat.pinnedMessageIds.includes(message.id) || message.pinned,
        );

  async function handleComposerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedText = composerText.trim();
    if (normalizedText === "") {
      setComposerError("Введите текст сообщения, прежде чем отправлять его.");
      chats.clearFeedback();
      return;
    }

    setComposerError(null);
    const success = await chats.sendMessage(normalizedText);
    if (success) {
      setComposerText("");
    }
  }

  return (
    <div className={styles.layout}>
      <section className={styles.heroCard}>
        <div className={styles.heroHeader}>
          <div>
            <p className={styles.cardLabel}>Chats</p>
            <h1 className={styles.title}>Direct chats через gateway</h1>
            <p className={styles.subtitle}>
              Первый thread UI работает только через aero-gateway. Websocket, polling,
              groups и media остаются за пределами этого slice.
            </p>
          </div>

          <button
            className={styles.secondaryButton}
            disabled={chats.state.status === "loading" || chats.state.isRefreshingList}
            onClick={() => {
              void chats.reloadChats();
            }}
            type="button"
          >
            {chats.state.isRefreshingList ? "Обновляем..." : "Обновить"}
          </button>
        </div>

        <div className={styles.metrics}>
          <Metric label="Чаты" value={chats.state.chats.length} />
          <Metric
            label="Сообщения"
            value={selectedThread?.messages.length ?? 0}
          />
          <Metric label="Закреплено" value={pinnedMessages.length} />
        </div>

        {chats.state.notice && <div className={styles.notice}>{chats.state.notice}</div>}
        {(composerError || chats.state.actionErrorMessage) && (
          <div className={styles.error}>
            {composerError ?? chats.state.actionErrorMessage}
          </div>
        )}
      </section>

      <div className={styles.grid}>
        <section className={styles.panelCard}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.cardLabel}>Список</p>
              <h2 className={styles.sectionTitle}>Ваши direct chats</h2>
            </div>
            <p className={styles.sectionDescription}>
              Чаты создаются только явным действием из раздела друзей.
            </p>
          </div>

          {chats.state.status === "loading" && (
            <StateCard
              title="Загружаем direct chats"
              message="Получаем список чатов через gateway."
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
                  Повторить
                </button>
              }
              tone="error"
            />
          )}

          {chats.state.status === "ready" && chats.state.chats.length === 0 && (
            <StateCard
              title="Direct chats пока нет"
              message="Создайте чат явным действием из списка друзей, чтобы открыть первый thread."
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
                const isActive = chat.id === chats.state.selectedChatId;

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
                      {describeChatCard(chat, peer)}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className={styles.panelCard}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.cardLabel}>Thread</p>
              <h2 className={styles.sectionTitle}>
                {selectedPeer ? selectedPeer.nickname : "Выберите чат"}
              </h2>
            </div>

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

          {selectedThread && (
            <div className={styles.threadMeta}>
              <span className={styles.metaTag}>
                {selectedPeer ? `@${selectedPeer.login}` : "participant"}
              </span>
              {renderReadChip(selectedThread.readState)}
              {renderTypingChip(selectedThread.typingState)}
              {renderPresenceChip(selectedThread.presenceState)}
            </div>
          )}

          {chats.state.status === "ready" &&
            chats.state.chats.length > 0 &&
            chats.state.selectedChatId === null && (
              <StateCard
                title="Thread ещё не выбран"
                message="Выберите direct chat слева, чтобы загрузить сообщения и composer."
              />
            )}

          {chats.state.threadStatus === "loading" && (
            <StateCard
              title="Загружаем thread"
              message="Получаем chat snapshot, историю сообщений и обновляем read position."
            />
          )}

          {chats.state.threadStatus === "error" && chats.state.selectedChatId && (
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
              {pinnedMessages.length > 0 && (
                <section className={styles.pinnedStrip}>
                  <p className={styles.cardLabel}>Pinned</p>
                  <div className={styles.pinnedList}>
                    {pinnedMessages.map((message) => (
                      <article key={message.id} className={styles.pinnedCard}>
                        <p className={styles.pinnedText}>
                          {describeMessagePreview(message)}
                        </p>
                        <span className={styles.pinnedMeta}>
                          {formatDateTime(message.createdAt)}
                        </span>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              <div className={styles.messagesList}>
                {selectedThread.messages.length === 0 ? (
                  <StateCard
                    title="Сообщений пока нет"
                    message="Отправьте первый текстовый message через gateway composer."
                  />
                ) : (
                  selectedThread.messages.map((message) => {
                    const isOwn = message.senderUserId === authState.profile.id;
                    const pendingLabel =
                      chats.state.pendingMessageActions[message.id] ?? null;

                    return (
                      <article
                        key={message.id}
                        className={styles.messageCard}
                        data-own={isOwn}
                      >
                        <div className={styles.messageHeader}>
                          <div>
                            <p className={styles.messageAuthor}>
                              {isOwn
                                ? "Вы"
                                : selectedPeer?.nickname ?? "Собеседник"}
                            </p>
                            <p className={styles.messageMeta}>
                              {formatDateTime(message.createdAt)}
                            </p>
                          </div>
                          {message.pinned && (
                            <span className={styles.metaTag}>Закреплено</span>
                          )}
                        </div>

                        <div className={styles.messageBody}>
                          {message.tombstone ? (
                            <p className={styles.tombstoneText}>
                              Сообщение удалено для всех.
                            </p>
                          ) : (
                            <p className={styles.messageText}>
                              {message.text?.text ?? ""}
                            </p>
                          )}
                        </div>

                        {!message.tombstone && (
                          <div className={styles.actions}>
                            <button
                              className={styles.secondaryButton}
                              disabled={pendingLabel !== null}
                              onClick={() => {
                                void (message.pinned
                                  ? chats.unpinMessage(message.id)
                                  : chats.pinMessage(message.id));
                              }}
                              type="button"
                            >
                              {message.pinned ? "Открепить" : "Закрепить"}
                            </button>

                            {isOwn && (
                              <button
                                className={styles.secondaryButton}
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

                        {pendingLabel && (
                          <p className={styles.pendingText}>{pendingLabel}</p>
                        )}
                      </article>
                    );
                  })
                )}
              </div>

              <form className={styles.composer} onSubmit={handleComposerSubmit}>
                <label className={styles.field}>
                  <span>Текст сообщения</span>
                  <textarea
                    disabled={chats.state.isSendingMessage}
                    onChange={(event) => {
                      setComposerText(event.target.value);
                      setComposerError(null);
                      chats.clearFeedback();
                    }}
                    placeholder="Напишите короткое текстовое сообщение"
                    rows={4}
                    value={composerText}
                  />
                </label>

                <div className={styles.actions}>
                  <button
                    className={styles.primaryButton}
                    disabled={chats.state.isSendingMessage}
                    type="submit"
                  >
                    {chats.state.isSendingMessage ? "Отправляем..." : "Отправить"}
                  </button>
                </div>
              </form>
            </div>
          )}
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

function describeChatCard(chat: DirectChat, peer: ChatUser | null): string {
  if (chat.pinnedMessageIds.length > 0) {
    return `Закреплено сообщений: ${chat.pinnedMessageIds.length}.`;
  }

  if (peer) {
    return `Direct thread с @${peer.login} без realtime-обновлений.`;
  }

  return "Direct thread готов к загрузке сообщений.";
}

function describeMessagePreview(message: DirectChatMessage): string {
  if (message.tombstone) {
    return "Удалённое сообщение";
  }

  const text = message.text?.text.trim() ?? "";
  if (text === "") {
    return "Текст недоступен";
  }

  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function renderReadChip(readState: DirectChatReadState | null) {
  if (!readState?.peerPosition) {
    return null;
  }

  return (
    <span className={styles.metaTag}>
      Прочитано: {formatDateTime(readState.peerPosition.updatedAt)}
    </span>
  );
}

function renderTypingChip(typingState: DirectChatTypingState | null) {
  if (!typingState?.peerTyping) {
    return null;
  }

  return (
    <span className={styles.metaTag}>
      Typing на момент запроса
    </span>
  );
}

function renderPresenceChip(presenceState: DirectChatPresenceState | null) {
  if (!presenceState?.peerPresence) {
    return null;
  }

  return (
    <span className={styles.metaTag}>
      Presence: {formatDateTime(presenceState.peerPresence.heartbeatAt)}
    </span>
  );
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
