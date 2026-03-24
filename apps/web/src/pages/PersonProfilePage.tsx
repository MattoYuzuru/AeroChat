import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { buildDirectChatRoutePath } from "../app/app-routes";
import { useAuth } from "../auth/useAuth";
import { gatewayClient } from "../gateway/runtime";
import {
  describeGatewayError,
  isGatewayErrorCode,
  type DirectChat,
} from "../gateway/types";
import {
  describePersonProfileSummary,
  describePersonRelationship,
  getPersonProfileLaunchTitle,
  resolvePersonProfileEntry,
} from "../people/profile-model";
import { usePeople } from "../people/usePeople";
import { useDesktopShellHost } from "../shell/context";
import styles from "./PersonProfilePage.module.css";

export function PersonProfilePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const desktopShellHost = useDesktopShellHost();
  const { state: authState, expireSession } = useAuth();
  const [isOpeningChat, setIsOpeningChat] = useState(false);
  const [chatActionError, setChatActionError] = useState<string | null>(null);
  const personId = searchParams.get("person")?.trim() ?? "";
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

  useEffect(() => {
    if (desktopShellHost === null || personEntry === null) {
      return;
    }

    desktopShellHost.syncCurrentRouteTitle(getPersonProfileLaunchTitle(personEntry.profile));
  }, [desktopShellHost, personEntry]);

  if (authState.status !== "authenticated") {
    return null;
  }

  function handleBackToPeople() {
    if (desktopShellHost !== null) {
      desktopShellHost.launchApp("people");
      navigate("/app/people");
      return;
    }

    navigate("/app/people");
  }

  async function handleOpenChat() {
    if (personEntry === null || personEntry.relationshipKind !== "friend") {
      return;
    }

    setIsOpeningChat(true);
    setChatActionError(null);
    people.clearFeedback();

    try {
      const existingChats = await gatewayClient.listDirectChats(sessionToken);
      const existingChat = findDirectChatByPeerUserId(existingChats, personEntry.profile.id);
      const chat =
        existingChat ?? (await gatewayClient.createDirectChat(sessionToken, personEntry.profile.id));
      const title = getPersonProfileLaunchTitle(personEntry.profile);

      if (desktopShellHost !== null) {
        desktopShellHost.openDirectChat({
          chatId: chat.id,
          title,
        });
      }

      navigate(buildDirectChatRoutePath(chat.id));
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

  return (
    <div className={styles.layout}>
      <section className={styles.heroCard}>
        <div className={styles.heroHeader}>
          <div>
            <p className={styles.cardLabel}>Person profile</p>
            <h1 className={styles.title}>
              {personEntry?.profile.nickname ?? "Профиль контакта"}
            </h1>
            <p className={styles.subtitle}>
              {personEntry === null
                ? "Канонический person-profile target остаётся привязан к already-known social graph snapshot и не превращается в публичный каталог."
                : `@${personEntry.profile.login} · ${describePersonRelationship(personEntry)}`}
            </p>
          </div>

          <button
            className={styles.secondaryButton}
            onClick={handleBackToPeople}
            type="button"
          >
            Назад к людям
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
          title="Person target не указан"
          message="Route должен содержать стабильный `person` identity key, иначе shell не сможет честно восстановить foreground target."
          action={
            <button
              className={styles.primaryButton}
              onClick={handleBackToPeople}
              type="button"
            >
              Открыть People
            </button>
          }
          tone="error"
        />
      )}

      {personId !== "" && people.state.status === "loading" && (
        <StateCard
          title="Загружаем профиль контакта"
          message="Подтягиваем current people snapshot через gateway, чтобы собрать profile-first окно без отдельного identity lookup."
        />
      )}

      {personId !== "" && people.state.status === "error" && (
        <StateCard
          title="Профиль контакта недоступен"
          message={
            people.state.screenErrorMessage ??
            "Не удалось загрузить bounded social graph snapshot."
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
          message="Этот person-profile target показывает только already-known friend/request entries. Если relationship уже изменилась, окно честно не притворяется глобальным profile lookup."
          action={
            <button
              className={styles.primaryButton}
              onClick={handleBackToPeople}
              type="button"
            >
              Вернуться к People
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
                <p className={styles.relationshipBadge}>
                  {describePersonRelationship(personEntry)}
                </p>
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
                    {isOpeningChat ? "Открываем чат..." : "Открыть чат"}
                  </button>
                  <button
                    className={styles.secondaryButton}
                    disabled={pendingLabel !== null || isOpeningChat}
                    onClick={() => {
                      setChatActionError(null);
                      void people.removeFriend(personEntry.profile.login);
                    }}
                    type="button"
                  >
                    {pendingLabel ?? "Удалить из друзей"}
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
                    {pendingLabel === "Принимаем..." ? pendingLabel : "Принять заявку"}
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
                    {pendingLabel === "Отклоняем..." ? pendingLabel : "Отклонить"}
                  </button>
                </>
              )}

              {personEntry.relationshipKind === "outgoing_request" && (
                <button
                  className={styles.primaryButton}
                  disabled={pendingLabel !== null}
                  onClick={() => {
                    setChatActionError(null);
                    void people.cancelOutgoingFriendRequest(personEntry.profile.login);
                  }}
                  type="button"
                >
                  {pendingLabel ?? "Отменить заявку"}
                </button>
              )}
            </div>

            {pendingLabel && <p className={styles.pendingText}>{pendingLabel}</p>}
          </section>

          <section className={styles.metaCard}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.cardLabel}>Публичные поля</p>
                <h3 className={styles.sectionTitle}>Профиль</h3>
              </div>
            </div>

            <dl className={styles.metaGrid}>
              <MetaItem label="Login" value={`@${personEntry.profile.login}`} />
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
                <p className={styles.cardLabel}>Social graph</p>
                <h3 className={styles.sectionTitle}>Контекст отношения</h3>
              </div>
            </div>

            <dl className={styles.metaGrid}>
              <MetaItem
                label="Состояние"
                value={describeRelationshipState(personEntry.relationshipKind)}
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
                label="Bio"
                value={personEntry.profile.bio?.trim() || "не заполнено"}
              />
            </dl>
          </section>
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
      <p className={styles.cardLabel}>Person state</p>
      <h2 className={styles.stateTitle}>{title}</h2>
      <p className={styles.stateMessage}>{message}</p>
      {action && <div className={styles.stateActions}>{action}</div>}
    </section>
  );
}

function describeRelationshipState(
  relationshipKind: "friend" | "incoming_request" | "outgoing_request",
): string {
  switch (relationshipKind) {
    case "friend":
      return "Друг";
    case "incoming_request":
      return "Входящая заявка";
    case "outgoing_request":
      return "Исходящая заявка";
    default:
      return "Контакт";
  }
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

function findDirectChatByPeerUserId(chats: DirectChat[], peerUserId: string): DirectChat | null {
  return (
    chats.find((chat) => chat.participants.some((participant) => participant.id === peerUserId)) ??
    null
  );
}
