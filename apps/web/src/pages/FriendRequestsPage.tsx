import { useNavigate } from "react-router-dom";
import { buildPersonProfileRoutePath } from "../app/app-routes";
import { useAuth } from "../auth/useAuth";
import type { Profile } from "../gateway/types";
import { getPersonProfileLaunchTitle } from "../people/profile-model";
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
  const people = usePeople({
    enabled: authState.status === "authenticated",
    token: authState.status === "authenticated" ? authState.token : "",
    onUnauthenticated: () => expireSession(),
  });

  if (authState.status !== "authenticated") {
    return null;
  }

  function openPersonProfile(profile: Profile) {
    const title = getPersonProfileLaunchTitle(profile);
    const searchParams = new URLSearchParams({
      from: "requests",
    });

    if (desktopShellHost !== null) {
      desktopShellHost.openPersonProfile({
        userId: profile.id,
        title,
        searchParams,
      });
    }

    navigate(buildPersonProfileRoutePath(profile.id, searchParams));
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
            <p className={styles.cardLabel}>Friend Requests</p>
            <h1 className={styles.title}>Заявки в друзья</h1>
            <p className={styles.subtitle}>
              Канонический singleton target для входящих и исходящих заявок. Здесь остаются только
              bounded request-actions и переход в canonical person-profile окно без скрытого
              создания чата или public discovery.
            </p>
          </div>

          <div className={styles.actions}>
            <button
              className={styles.secondaryButton}
              disabled={people.state.status === "loading" || people.state.isRefreshing}
              onClick={() => {
                void people.reload();
              }}
              type="button"
            >
              {people.state.isRefreshing ? "Обновляем..." : "Обновить"}
            </button>
            <button
              className={styles.secondaryButton}
              onClick={openPeopleWorkspace}
              type="button"
            >
              Люди
            </button>
          </div>
        </div>

        <div className={styles.metrics}>
          <Metric label="Входящие" value={people.state.snapshot.incoming.length} />
          <Metric label="Исходящие" value={people.state.snapshot.outgoing.length} />
          <Metric
            label="Всего активных"
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
          message="Получаем входящие и исходящие friend requests через gateway."
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
            description="Принятие и отклонение reuse'ят текущие people hooks и gateway mutations."
            emptyMessage="Сейчас нет входящих заявок."
          >
            {people.state.snapshot.incoming.map((request) => {
              const pendingLabel = people.state.pendingLogins[request.profile.login];

              return (
                <ProfileCard
                  key={request.profile.id || request.profile.login}
                  metaLabel={`Запрос: ${formatDateTime(request.requestedAt)}`}
                  onOpenProfile={() => {
                    openPersonProfile(request.profile);
                  }}
                  pendingLabel={pendingLabel}
                  profile={request.profile}
                  primaryAction={{
                    label: "Принять",
                    onClick: () => {
                      void people.acceptFriendRequest(request.profile.login);
                    },
                  }}
                  secondaryAction={{
                    label: "Отклонить",
                    onClick: () => {
                      void people.declineFriendRequest(request.profile.login);
                    },
                  }}
                />
              );
            })}
          </PeopleSection>

          <PeopleSection
            title="Исходящие заявки"
            description="До принятия второй стороной заявку можно отменить в том же canonical app."
            emptyMessage="Исходящих заявок пока нет."
          >
            {people.state.snapshot.outgoing.map((request) => {
              const pendingLabel = people.state.pendingLogins[request.profile.login];

              return (
                <ProfileCard
                  key={request.profile.id || request.profile.login}
                  metaLabel={`Отправлено: ${formatDateTime(request.requestedAt)}`}
                  onOpenProfile={() => {
                    openPersonProfile(request.profile);
                  }}
                  pendingLabel={pendingLabel}
                  profile={request.profile}
                  primaryAction={{
                    label: "Отменить",
                    onClick: () => {
                      void people.cancelOutgoingFriendRequest(request.profile.login);
                    },
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
