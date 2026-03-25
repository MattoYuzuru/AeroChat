import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { buildFriendRequestsRoutePath } from "../app/app-routes";
import { useAuth } from "../auth/useAuth";
import {
  describeGatewayError,
  isGatewayErrorCode,
  type Profile,
} from "../gateway/types";
import { getPersonProfileLaunchTitle } from "../people/profile-model";
import {
  buildDirectChatNavigationIntent,
  buildPersonProfileNavigationIntent,
  ensureDirectChatForPeer,
} from "../people/navigation";
import { resolvePersonRelationshipActions } from "../people/relationship-actions";
import { usePeople } from "../people/usePeople";
import { useDesktopShellHost } from "../shell/context";
import {
  Metric,
  PeopleSection,
  ProfileCard,
  StateCard,
} from "./PeopleShared";
import { formatDateTime } from "./PeopleFormatting";
import styles from "./PeoplePage.module.css";

export function PeoplePage() {
  const navigate = useNavigate();
  const desktopShellHost = useDesktopShellHost();
  const { state: authState, expireSession } = useAuth();
  const [login, setLogin] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [openingChatLogin, setOpeningChatLogin] = useState<string | null>(null);
  const [chatActionError, setChatActionError] = useState<string | null>(null);
  const people = usePeople({
    enabled: authState.status === "authenticated",
    token: authState.status === "authenticated" ? authState.token : "",
    onUnauthenticated: () => expireSession(),
  });
  const incomingActions = resolvePersonRelationshipActions("incoming_request");
  const outgoingActions = resolvePersonRelationshipActions("outgoing_request");
  const friendActions = resolvePersonRelationshipActions("friend");

  if (authState.status !== "authenticated") {
    return null;
  }

  const sessionToken = authState.token;

  function openPersonProfile(profile: Profile) {
    const intent = buildPersonProfileNavigationIntent({
      userId: profile.id,
      title: getPersonProfileLaunchTitle(profile),
      source: "people",
    });

    if (desktopShellHost !== null) {
      desktopShellHost.openPersonProfile(intent.shellOptions);
    }

    navigate(intent.routePath);
  }

  function openFriendRequests() {
    if (desktopShellHost !== null) {
      desktopShellHost.launchApp("friend_requests");
    }

    navigate(buildFriendRequestsRoutePath());
  }

  async function handleOpenFriendChat(profile: Profile) {
    if (openingChatLogin !== null) {
      return;
    }

    setOpeningChatLogin(profile.login);
    setChatActionError(null);
    people.clearFeedback();

    try {
      const chat = await ensureDirectChatForPeer(sessionToken, profile.id);
      const intent = buildDirectChatNavigationIntent({
        chatId: chat.id,
        title: getPersonProfileLaunchTitle(profile),
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
        describeGatewayError(error, "Не удалось открыть чат для выбранного контакта."),
      );
    } finally {
      setOpeningChatLogin(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedLogin = login.trim();

    if (normalizedLogin === "") {
      setFormError("Введите точный неизменяемый login, чтобы отправить заявку.");
      people.clearFeedback();
      return;
    }

    setFormError(null);
    const success = await people.sendFriendRequest(normalizedLogin);
    if (success) {
      setLogin("");
    }
  }

  return (
    <div className={styles.layout}>
      <section className={styles.heroCard}>
        <div className={styles.heroHeader}>
          <div>
            <p className={styles.cardLabel}>Люди</p>
            <h1 className={styles.title}>Люди</h1>
            <p className={styles.subtitle}>
              Добавляйте людей по точному login и открывайте профиль или чат без лишних окон.
            </p>
          </div>

          <button
            className={styles.secondaryButton}
            onClick={openFriendRequests}
            type="button"
          >
            Заявки
          </button>
        </div>

        <div className={styles.metrics}>
          <Metric label="Входящие" value={people.state.snapshot.incoming.length} />
          <Metric label="Исходящие" value={people.state.snapshot.outgoing.length} />
          <Metric label="Друзья" value={people.state.snapshot.friends.length} />
        </div>

        {people.state.notice && <div className={styles.notice}>{people.state.notice}</div>}
        {(formError || people.state.actionErrorMessage || chatActionError) && (
          <div className={styles.error}>
            {formError ?? people.state.actionErrorMessage ?? chatActionError}
          </div>
        )}

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>Точный login</span>
            <input
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              disabled={people.state.isSendingRequest}
              onChange={(event) => {
                setLogin(event.target.value);
                setFormError(null);
                people.clearFeedback();
              }}
              placeholder="alice"
              spellCheck={false}
              value={login}
            />
          </label>

          <button
            className={styles.primaryButton}
            disabled={people.state.isSendingRequest}
            type="submit"
          >
            {people.state.isSendingRequest ? "Отправляем..." : "Отправить заявку"}
          </button>
        </form>
      </section>

      {people.state.status === "loading" && (
        <StateCard
          title="Загружаем людей"
          message="Собираем друзей и заявки."
        />
      )}

      {people.state.status === "error" && (
        <StateCard
          title="Раздел людей недоступен"
          message={people.state.screenErrorMessage ?? "Не удалось загрузить данные."}
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

      {people.state.status === "ready" && (
        <div className={styles.grid}>
          <PeopleSection
            title="Входящие заявки"
            description="Новые заявки на добавление в друзья."
            emptyMessage="Пока нет новых заявок."
          >
            {people.state.snapshot.incoming.map((request) => {
              const pendingLabel = people.state.pendingLogins[request.profile.login];

              return (
                <ProfileCard
                  key={request.profile.id || request.profile.login}
                  metaLabel={`Запрос: ${formatDateTime(request.requestedAt)}`}
                  statusLabel="Входящая заявка"
                  onOpenProfile={() => {
                    openPersonProfile(request.profile);
                  }}
                  pendingLabel={pendingLabel}
                  profile={request.profile}
                  primaryAction={{
                    label: incomingActions.primary.label,
                    onClick: () => {
                      void people.acceptFriendRequest(request.profile.login);
                    },
                    tone: incomingActions.primary.tone,
                  }}
                  secondaryAction={{
                    label: incomingActions.secondary?.label ?? "Отклонить",
                    onClick: () => {
                      void people.declineFriendRequest(request.profile.login);
                    },
                    tone: incomingActions.secondary?.tone,
                  }}
                />
              );
            })}
          </PeopleSection>

          <PeopleSection
            title="Исходящие заявки"
            description="Ожидают ответа второй стороны."
            emptyMessage="Пока нет исходящих заявок."
          >
            {people.state.snapshot.outgoing.map((request) => {
              const pendingLabel = people.state.pendingLogins[request.profile.login];

              return (
                <ProfileCard
                  key={request.profile.id || request.profile.login}
                  metaLabel={`Отправлено: ${formatDateTime(request.requestedAt)}`}
                  statusLabel="Исходящая заявка"
                  onOpenProfile={() => {
                    openPersonProfile(request.profile);
                  }}
                  pendingLabel={pendingLabel}
                  profile={request.profile}
                  primaryAction={{
                    label: outgoingActions.primary.label,
                    onClick: () => {
                      void people.cancelOutgoingFriendRequest(request.profile.login);
                    },
                    tone: outgoingActions.primary.tone,
                  }}
                />
              );
            })}
          </PeopleSection>

          <PeopleSection
            title="Друзья"
            description="Профиль и чат открываются отдельно."
            emptyMessage="Пока нет друзей."
          >
            {people.state.snapshot.friends.map((friend) => {
              const pendingLabel = people.state.pendingLogins[friend.profile.login];
              const isOpeningCurrentChat = openingChatLogin === friend.profile.login;

              return (
                <ProfileCard
                  key={friend.profile.id || friend.profile.login}
                  metaLabel={`Друзья с ${formatDateTime(friend.friendsSince)}`}
                  statusLabel="Друг"
                  onOpenProfile={() => {
                    openPersonProfile(friend.profile);
                  }}
                  pendingLabel={
                    isOpeningCurrentChat ? "Открываем чат..." : pendingLabel
                  }
                  profile={friend.profile}
                  primaryAction={{
                    label: isOpeningCurrentChat
                      ? "Открываем чат..."
                      : friendActions.primary.label,
                    onClick: () => {
                      void handleOpenFriendChat(friend.profile);
                    },
                    tone: friendActions.primary.tone,
                  }}
                  secondaryAction={{
                    label: friendActions.secondary?.label ?? "Удалить из друзей",
                    onClick: () => {
                      void people.removeFriend(friend.profile.login);
                    },
                    tone: friendActions.secondary?.tone,
                  }}
                />
              );
            })}
          </PeopleSection>
        </div>
      )}
    </div>
  );
}
