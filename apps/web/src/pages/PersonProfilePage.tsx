import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { buildFriendRequestsRoutePath } from "../app/app-routes";
import { useAuth } from "../auth/useAuth";
import { gatewayClient } from "../gateway/runtime";
import { useWebNotifications } from "../notifications/context";
import {
  describeGatewayError,
  isGatewayErrorCode,
  type DirectChat,
} from "../gateway/types";
import {
  describePersonProfileSummary,
  describePersonRelationship,
  describePersonRelationshipState,
  getPersonProfileLaunchTitle,
  resolvePersonProfileEntry,
} from "../people/profile-model";
import {
  buildDirectChatNavigationIntent,
  ensureDirectChatForPeer,
  findDirectChatByPeerUserId,
} from "../people/navigation";
import { resolvePersonRelationshipActions } from "../people/relationship-actions";
import { usePeople } from "../people/usePeople";
import { useDesktopShellHost, useDesktopShellWindowLocation } from "../shell/context";
import styles from "./PersonProfilePage.module.css";

export function PersonProfilePage() {
  const navigate = useNavigate();
  const desktopShellHost = useDesktopShellHost();
  const windowLocation = useDesktopShellWindowLocation();
  const searchParams = useMemo(
    () => new URLSearchParams(windowLocation.search),
    [windowLocation.search],
  );
  const {
    state: authState,
    expireSession,
    updateProfile,
    clearNotice,
  } = useAuth();
  const webNotifications = useWebNotifications();
  const [isOpeningChat, setIsOpeningChat] = useState(false);
  const [chatActionError, setChatActionError] = useState<string | null>(null);
  const [directChat, setDirectChat] = useState<DirectChat | null>(null);
  const [isLoadingDirectChat, setIsLoadingDirectChat] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [isUpdatingNotifications, setIsUpdatingNotifications] = useState(false);
  const personId = searchParams.get("person")?.trim() ?? "";
  const sourceSurface = searchParams.get("from")?.trim() ?? "";
  const sessionToken = authState.status === "authenticated" ? authState.token : "";
  const people = usePeople({
    enabled: authState.status === "authenticated",
    token: sessionToken,
    onUnauthenticated: expireSession,
  });
  const personEntry = useMemo(
    () =>
      people.state.status === "ready"
        ? resolvePersonProfileEntry(people.state.snapshot, personId)
        : null,
    [people.state.snapshot, people.state.status, personId],
  );
  const pendingLabel =
    personEntry === null ? null : people.state.pendingLogins[personEntry.profile.login] ?? null;
  const relationshipActions =
    personEntry === null
      ? null
      : resolvePersonRelationshipActions(personEntry.relationshipKind);

  useEffect(() => {
    if (desktopShellHost === null || personEntry === null) {
      return;
    }

    desktopShellHost.syncCurrentRouteTitle(getPersonProfileLaunchTitle(personEntry.profile));
  }, [desktopShellHost, personEntry]);

  useEffect(() => {
    if (personEntry?.relationshipKind !== "friend") {
      setDirectChat(null);
      setIsLoadingDirectChat(false);
      return;
    }

    let cancelled = false;
    setIsLoadingDirectChat(true);

    void gatewayClient
      .listDirectChats(sessionToken)
      .then((chats) => {
        if (cancelled) {
          return;
        }

        setDirectChat(findDirectChatByPeerUserId(chats, personEntry.profile.id));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (isGatewayErrorCode(error, "unauthenticated")) {
          expireSession();
          return;
        }

        setNotificationError(
          describeGatewayError(error, "Не удалось получить настройки уведомлений для контакта."),
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingDirectChat(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [expireSession, personEntry, sessionToken]);

  if (authState.status !== "authenticated") {
    return null;
  }
  const authProfile = authState.profile;

  function handleBackToPeople() {
    const targetAppId = sourceSurface === "requests" ? "friend_requests" : "people";
    const targetRoutePath =
      sourceSurface === "requests" ? buildFriendRequestsRoutePath() : "/app/people";

    if (desktopShellHost !== null) {
      desktopShellHost.launchApp(targetAppId);
      navigate(targetRoutePath);
      return;
    }

    navigate(targetRoutePath);
  }

  async function handleOpenChat() {
    if (personEntry === null || personEntry.relationshipKind !== "friend") {
      return;
    }

    setIsOpeningChat(true);
    setChatActionError(null);
    people.clearFeedback();

    try {
      const chat = await ensureDirectChatForPeer(sessionToken, personEntry.profile.id);
      const intent = buildDirectChatNavigationIntent({
        chatId: chat.id,
        title: getPersonProfileLaunchTitle(personEntry.profile),
      });

      if (desktopShellHost !== null) {
        desktopShellHost.openDirectChat(intent.shellOptions);
      }

      navigate(intent.routePath);
    } catch (error) {
      if (isGatewayErrorCode(error, "unauthenticated")) {
        expireSession();
        return;
      }

      setChatActionError(
        describeGatewayError(error, "Не удалось открыть личный чат для выбранного контакта."),
      );
    } finally {
      setIsOpeningChat(false);
    }
  }

  async function handleDirectNotificationsToggle(nextEnabled: boolean) {
    if (personEntry === null || personEntry.relationshipKind !== "friend") {
      return;
    }

    setNotificationError(null);
    webNotifications.clearError();
    clearNotice();
    setIsUpdatingNotifications(true);

    try {
      if (nextEnabled && authProfile.pushNotificationsEnabled !== true) {
        const pushReady = await webNotifications.ensureBrowserPush(sessionToken);
        if (!pushReady) {
          throw new Error(
            webNotifications.error ??
              "Не удалось подготовить browser push для этого устройства.",
          );
        }

        await updateProfile({
          pushNotificationsEnabled: true,
        });
      }

      const targetChat =
        directChat ?? (await ensureDirectChatForPeer(sessionToken, personEntry.profile.id));
      const nextChat = await gatewayClient.setDirectChatNotifications(
        sessionToken,
        targetChat.id,
        nextEnabled,
      );
      setDirectChat(nextChat);
    } catch (error) {
      if (isGatewayErrorCode(error, "unauthenticated")) {
        expireSession();
        return;
      }

      setNotificationError(
        describeGatewayError(
          error,
          nextEnabled
            ? "Не удалось включить уведомления для этого контакта."
            : "Не удалось отключить уведомления для этого контакта.",
        ),
      );
    } finally {
      setIsUpdatingNotifications(false);
    }
  }

  return (
    <div className={styles.layout}>
      <section className={styles.heroCard}>
        <div className={styles.heroHeader}>
          <div>
            <p className={styles.cardLabel}>Контакт</p>
            <h1 className={styles.title}>
              {personEntry?.profile.nickname ?? "Профиль контакта"}
            </h1>
            <p className={styles.subtitle}>
              {personEntry === null
                ? "Профиль открывается для ваших друзей и заявок."
                : `@${personEntry.profile.login} · ${describePersonRelationship(personEntry)}`}
            </p>
          </div>

          <button
            className={styles.secondaryButton}
            onClick={handleBackToPeople}
            type="button"
          >
            {sourceSurface === "requests" ? "Назад к заявкам" : "Назад к людям"}
          </button>
        </div>

        {chatActionError && <div className={styles.error}>{chatActionError}</div>}
        {people.state.actionErrorMessage && (
          <div className={styles.error}>{people.state.actionErrorMessage}</div>
        )}
        {people.state.notice && <div className={styles.notice}>{people.state.notice}</div>}
      </section>

      {personId === "" && (
        <StateCard
          title="Профиль не найден"
          message="Не удалось определить, чей профиль нужно открыть."
          action={
            <button
              className={styles.primaryButton}
              onClick={handleBackToPeople}
              type="button"
            >
              Открыть людей
            </button>
          }
          tone="error"
        />
      )}

      {personId !== "" && people.state.status === "loading" && (
        <StateCard
          title="Загружаем профиль контакта"
          message="Собираем данные контакта."
        />
      )}

      {personId !== "" && people.state.status === "error" && (
        <StateCard
          title="Профиль контакта недоступен"
          message={
            people.state.screenErrorMessage ?? "Не удалось загрузить профиль."
          }
          action={
            <button
              className={styles.primaryButton}
              onClick={() => {
                void people.reload();
              }}
              type="button"
            >
              Повторить
            </button>
          }
          tone="error"
        />
      )}

      {personId !== "" && people.state.status === "ready" && personEntry === null && (
        <StateCard
          title="Контакт больше не доступен"
          message="Этот профиль больше не отображается среди ваших друзей и заявок."
          action={
            <button
              className={styles.primaryButton}
              onClick={handleBackToPeople}
              type="button"
            >
              Вернуться к людям
            </button>
          }
          tone="error"
        />
      )}

      {personEntry !== null && people.state.status === "ready" && (
        <div className={styles.contentGrid}>
          <section className={styles.summaryCard}>
            <div className={styles.identityRow}>
              {personEntry.profile.avatarUrl ? (
                <img
                  alt={`Аватар ${personEntry.profile.nickname}`}
                  className={styles.avatarImage}
                  src={personEntry.profile.avatarUrl}
                />
              ) : (
                <div className={styles.avatarBadge} aria-hidden="true">
                  {getProfileInitials(personEntry.profile)}
                </div>
              )}

              <div className={styles.identityBody}>
                <div className={styles.identityMetaRow}>
                  <span className={styles.relationshipBadge}>
                    {describePersonRelationshipState(personEntry.relationshipKind)}
                  </span>
                  <span className={styles.identityContext}>
                    {describePersonRelationship(personEntry)}
                  </span>
                </div>
                <h2 className={styles.identityTitle}>{personEntry.profile.nickname}</h2>
                <p className={styles.identityLogin}>@{personEntry.profile.login}</p>
                <p className={styles.identitySummary}>
                  {describePersonProfileSummary(personEntry.profile)}
                </p>
              </div>
            </div>

            <div className={styles.actions}>
              {personEntry.relationshipKind === "friend" && (
                <>
                  <button
                    className={styles.primaryButton}
                    disabled={isOpeningChat || pendingLabel !== null}
                    onClick={() => {
                      void handleOpenChat();
                    }}
                    type="button"
                  >
                    {isOpeningChat ? "Открываем чат..." : relationshipActions?.primary.label}
                  </button>
                  <button
                    className={styles.dangerButton}
                    disabled={pendingLabel !== null || isOpeningChat}
                    onClick={() => {
                      setChatActionError(null);
                      void people.removeFriend(personEntry.profile.login);
                    }}
                    type="button"
                  >
                    {pendingLabel ?? relationshipActions?.secondary?.label}
                  </button>
                </>
              )}

              {personEntry.relationshipKind === "incoming_request" && (
                <>
                  <button
                    className={styles.primaryButton}
                    disabled={pendingLabel !== null}
                    onClick={() => {
                      setChatActionError(null);
                      void people.acceptFriendRequest(personEntry.profile.login);
                    }}
                    type="button"
                  >
                    {pendingLabel === "Принимаем..."
                      ? pendingLabel
                      : relationshipActions?.primary.label}
                  </button>
                  <button
                    className={styles.secondaryButton}
                    disabled={pendingLabel !== null}
                    onClick={() => {
                      setChatActionError(null);
                      void people.declineFriendRequest(personEntry.profile.login);
                    }}
                    type="button"
                  >
                    {pendingLabel === "Отклоняем..."
                      ? pendingLabel
                      : relationshipActions?.secondary?.label}
                  </button>
                </>
              )}

              {personEntry.relationshipKind === "outgoing_request" && (
                <button
                  className={styles.secondaryButton}
                  disabled={pendingLabel !== null}
                  onClick={() => {
                    setChatActionError(null);
                    void people.cancelOutgoingFriendRequest(personEntry.profile.login);
                  }}
                  type="button"
                >
                  {pendingLabel ?? relationshipActions?.primary.label}
                </button>
              )}
            </div>

            {pendingLabel && <p className={styles.pendingText}>{pendingLabel}</p>}
          </section>

          <section className={styles.metaCard}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.cardLabel}>Основное</p>
                <h3 className={styles.sectionTitle}>О человеке</h3>
              </div>
            </div>

            <dl className={styles.metaGrid}>
              <MetaItem label="Логин" value={`@${personEntry.profile.login}`} />
              <MetaItem label="Статус" value={personEntry.profile.statusText ?? "не задан"} />
              <MetaItem
                label="Город"
                value={personEntry.profile.city?.trim() || "не указан"}
              />
              <MetaItem
                label="Страна"
                value={personEntry.profile.country?.trim() || "не указана"}
              />
              <MetaItem
                label="День рождения"
                value={personEntry.profile.birthday?.trim() || "не задан"}
              />
              <MetaItem
                label="Обновлён"
                value={formatDateTime(personEntry.profile.updatedAt)}
              />
            </dl>
          </section>

          <section className={styles.metaCard}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.cardLabel}>Связь</p>
                <h3 className={styles.sectionTitle}>Текущий статус</h3>
              </div>
            </div>

            <dl className={styles.metaGrid}>
              <MetaItem
                label="Состояние"
                value={describePersonRelationshipState(personEntry.relationshipKind)}
              />
              <MetaItem
                label="Дата связи"
                value={
                  personEntry.relationshipKind === "friend"
                    ? formatDateTime(personEntry.friendsSince)
                    : formatDateTime(personEntry.requestedAt)
                }
              />
              <MetaItem
                label="Создан"
                value={formatDateTime(personEntry.profile.createdAt)}
              />
              <MetaItem
                label="О себе"
                value={personEntry.profile.bio?.trim() || "не заполнено"}
              />
            </dl>
          </section>

          {personEntry.relationshipKind === "friend" && (
            <section className={styles.metaCard}>
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.cardLabel}>Уведомления</p>
                  <h3 className={styles.sectionTitle}>Личный чат с этим контактом</h3>
                </div>
              </div>

              {(notificationError || webNotifications.error) && (
                <div className={styles.error}>
                  {notificationError ?? webNotifications.error}
                </div>
              )}

              <label className={styles.notificationToggleCard}>
                <div className={styles.notificationToggleCopy}>
                  <strong>Уведомления по этому чату</strong>
                  <span>
                    Push приходит только для нового непрочитанного входа и не дублируется, если
                    AeroChat уже открыт на экране.
                  </span>
                </div>
                <input
                  checked={directChat?.notificationsEnabled !== false}
                  className={`${styles.notificationToggleInput} xpCheckbox`}
                  disabled={
                    isLoadingDirectChat ||
                    isUpdatingNotifications ||
                    webNotifications.isSupported === false
                  }
                  onChange={(event) => {
                    void handleDirectNotificationsToggle(event.target.checked);
                  }}
                  type="checkbox"
                />
              </label>

              <p className={styles.helperText}>
                Browser push:{" "}
                {describeInlineBrowserPushState(
                  webNotifications.isSupported,
                  webNotifications.permission,
                  webNotifications.subscriptionStatus,
                )}
              </p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metaItem}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function StateCard({
  title,
  message,
  action,
  tone = "default",
}: {
  title: string;
  message: string;
  action?: ReactNode;
  tone?: "default" | "error";
}) {
  return (
    <section className={styles.stateCard} data-tone={tone}>
      <p className={styles.cardLabel}>Контакт</p>
      <h2 className={styles.stateTitle}>{title}</h2>
      <p className={styles.stateMessage}>{message}</p>
      {action && <div className={styles.stateActions}>{action}</div>}
    </section>
  );
}

function getProfileInitials(profile: { nickname: string; login: string }): string {
  const source = profile.nickname.trim() || profile.login.trim() || "P";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }

  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function formatDateTime(value: string | null): string {
  if (value === null || value.trim() === "") {
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

function describeInlineBrowserPushState(
  isSupported: boolean,
  permission: NotificationPermission | "unsupported",
  subscriptionStatus: "idle" | "syncing" | "active" | "inactive",
) {
  if (!isSupported || permission === "unsupported") {
    return "не поддерживается этим браузером";
  }
  if (subscriptionStatus === "syncing") {
    return "синхронизируем subscription";
  }
  if (permission === "denied") {
    return "разрешение заблокировано";
  }
  if (permission === "default") {
    return "разрешение ещё не выдано";
  }
  if (subscriptionStatus === "active") {
    return "готов на этом устройстве";
  }

  return "разрешение выдано, но push ещё не активирован";
}
