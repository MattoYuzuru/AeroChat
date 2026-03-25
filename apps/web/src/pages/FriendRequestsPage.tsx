import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import type { Profile } from "../gateway/types";
import {
  describePersonRelationshipState,
  getPersonProfileLaunchTitle,
} from "../people/profile-model";
import { buildPersonProfileNavigationIntent } from "../people/navigation";
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

export function FriendRequestsPage() {
  const navigate = useNavigate();
  const desktopShellHost = useDesktopShellHost();
  const { state: authState, expireSession } = useAuth();
  const incomingActions = resolvePersonRelationshipActions("incoming_request");
  const outgoingActions = resolvePersonRelationshipActions("outgoing_request");
  const people = usePeople({
    enabled: authState.status === "authenticated",
    token: authState.status === "authenticated" ? authState.token : "",
    onUnauthenticated: () => expireSession(),
  });

  if (authState.status !== "authenticated") {
    return null;
  }

  function openPersonProfile(profile: Profile) {
    const intent = buildPersonProfileNavigationIntent({
      userId: profile.id,
      title: getPersonProfileLaunchTitle(profile),
      source: "requests",
    });

    if (desktopShellHost !== null) {
      desktopShellHost.openPersonProfile(intent.shellOptions);
    }

    navigate(intent.routePath);
  }

  function openPeopleWorkspace() {
    if (desktopShellHost !== null) {
      desktopShellHost.launchApp("people");
    }

    navigate("/app/people");
  }

  return (
    <div className={styles.layout}>
      <section className={styles.heroCard}>
        <div className={styles.heroHeader}>
          <div>
            <p className={styles.cardLabel}>Заявки</p>
            <h1 className={styles.title}>Заявки в друзья</h1>
            <p className={styles.subtitle}>
              Все входящие и исходящие заявки в одном месте.
            </p>
          </div>

          <button
            className={styles.secondaryButton}
            onClick={openPeopleWorkspace}
            type="button"
          >
            Люди
          </button>
        </div>

        <div className={styles.metrics}>
          <Metric label="Входящие" value={people.state.snapshot.incoming.length} />
          <Metric label="Исходящие" value={people.state.snapshot.outgoing.length} />
          <Metric
            label="Активные"
            value={people.state.snapshot.incoming.length + people.state.snapshot.outgoing.length}
          />
        </div>

        {people.state.notice && <div className={styles.notice}>{people.state.notice}</div>}
        {people.state.actionErrorMessage && (
          <div className={styles.error}>{people.state.actionErrorMessage}</div>
        )}
      </section>

      {people.state.status === "loading" && (
        <StateCard
          title="Загружаем заявки"
          message="Собираем входящие и исходящие заявки."
        />
      )}

      {people.state.status === "error" && (
        <StateCard
          title="Раздел заявок недоступен"
          message={people.state.screenErrorMessage ?? "Не удалось загрузить заявки."}
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
                  statusLabel={describePersonRelationshipState("incoming_request")}
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
                  statusLabel={describePersonRelationshipState("outgoing_request")}
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
        </div>
      )}
    </div>
  );
}
