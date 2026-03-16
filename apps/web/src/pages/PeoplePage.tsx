import { Children, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "../auth/useAuth";
import type { Profile } from "../gateway/types";
import { usePeople } from "../people/usePeople";
import styles from "./PeoplePage.module.css";

export function PeoplePage() {
  const { state: authState, expireSession } = useAuth();
  const [login, setLogin] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const people = usePeople({
    enabled: authState.status === "authenticated",
    token: authState.status === "authenticated" ? authState.token : "",
    onUnauthenticated: () => expireSession(),
  });

  if (authState.status !== "authenticated") {
    return null;
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
            <p className={styles.cardLabel}>People</p>
            <h1 className={styles.title}>Друзья по точному login</h1>
            <p className={styles.subtitle}>
              Frontend social graph bootstrap идёт только через aero-gateway. Публичного каталога,
              fuzzy search и direct chat UI здесь пока нет.
            </p>
          </div>

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
        </div>

        <div className={styles.metrics}>
          <Metric label="Входящие" value={people.state.snapshot.incoming.length} />
          <Metric label="Исходящие" value={people.state.snapshot.outgoing.length} />
          <Metric label="Друзья" value={people.state.snapshot.friends.length} />
        </div>

        {people.state.notice && <div className={styles.notice}>{people.state.notice}</div>}
        {(formError || people.state.actionErrorMessage) && (
          <div className={styles.error}>
            {formError ?? people.state.actionErrorMessage}
          </div>
        )}

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>Точный неизменяемый login</span>
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
          title="Загружаем social graph"
          message="Получаем входящие, исходящие и текущих друзей через gateway."
        />
      )}

      {people.state.status === "error" && (
        <StateCard
          title="People раздел недоступен"
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
            description="Только точные friend requests без скрытого создания чата."
            emptyMessage="Сейчас нет входящих заявок."
          >
            {people.state.snapshot.incoming.map((request) => {
              const pendingLabel = people.state.pendingLogins[request.profile.login];

              return (
                <ProfileCard
                  key={request.profile.id || request.profile.login}
                  metaLabel={`Запрос: ${formatDateTime(request.requestedAt)}`}
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
            description="Можно отменить до принятия второй стороной."
            emptyMessage="Исходящих заявок пока нет."
          >
            {people.state.snapshot.outgoing.map((request) => {
              const pendingLabel = people.state.pendingLogins[request.profile.login];

              return (
                <ProfileCard
                  key={request.profile.id || request.profile.login}
                  metaLabel={`Отправлено: ${formatDateTime(request.requestedAt)}`}
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

          <PeopleSection
            title="Друзья"
            description="Friendship готова для следующего slice, но direct chat creation остаётся отдельным PR."
            emptyMessage="Список друзей пока пуст."
          >
            {people.state.snapshot.friends.map((friend) => {
              const pendingLabel = people.state.pendingLogins[friend.profile.login];

              return (
                <ProfileCard
                  key={friend.profile.id || friend.profile.login}
                  metaLabel={`Друзья с ${formatDateTime(friend.friendsSince)}`}
                  pendingLabel={pendingLabel}
                  profile={friend.profile}
                  primaryAction={{
                    label: "Удалить из друзей",
                    onClick: () => {
                      void people.removeFriend(friend.profile.login);
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
      <p className={styles.cardLabel}>People state</p>
      <h2 className={styles.stateTitle}>{title}</h2>
      <p className={styles.stateMessage}>{message}</p>
      {action && <div className={styles.stateActions}>{action}</div>}
    </section>
  );
}

interface PeopleSectionProps {
  title: string;
  description: string;
  emptyMessage: string;
  children: ReactNode;
}

function PeopleSection({
  title,
  description,
  emptyMessage,
  children,
}: PeopleSectionProps) {
  const items = Children.toArray(children);

  return (
    <section className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.cardLabel}>Список</p>
          <h2 className={styles.sectionTitle}>{title}</h2>
        </div>
        <p className={styles.sectionDescription}>{description}</p>
      </div>

      {items.length === 0 ? (
        <p className={styles.emptyState}>{emptyMessage}</p>
      ) : (
        <div className={styles.list}>{items}</div>
      )}
    </section>
  );
}

interface ActionConfig {
  label: string;
  onClick(): void;
}

interface ProfileCardProps {
  profile: Profile;
  metaLabel: string;
  pendingLabel?: string;
  primaryAction?: ActionConfig;
  secondaryAction?: ActionConfig;
}

function ProfileCard({
  profile,
  metaLabel,
  pendingLabel,
  primaryAction,
  secondaryAction,
}: ProfileCardProps) {
  const isPending = typeof pendingLabel === "string";

  return (
    <article className={styles.personCard}>
      <div className={styles.personHeader}>
        <div>
          <h3 className={styles.personTitle}>{profile.nickname}</h3>
          <p className={styles.personLogin}>@{profile.login}</p>
        </div>
        <span className={styles.metaTag}>{metaLabel}</span>
      </div>

      <p className={styles.personDescription}>{describeProfile(profile)}</p>

      <div className={styles.actions}>
        {primaryAction && (
          <button
            className={styles.primaryButton}
            disabled={isPending}
            onClick={primaryAction.onClick}
            type="button"
          >
            {primaryAction.label}
          </button>
        )}
        {secondaryAction && (
          <button
            className={styles.secondaryButton}
            disabled={isPending}
            onClick={secondaryAction.onClick}
            type="button"
          >
            {secondaryAction.label}
          </button>
        )}
      </div>

      {pendingLabel && <p className={styles.pendingText}>{pendingLabel}</p>}
    </article>
  );
}

function describeProfile(profile: Profile): string {
  if (profile.statusText && profile.statusText.trim() !== "") {
    return profile.statusText;
  }

  if (profile.bio && profile.bio.trim() !== "") {
    return profile.bio;
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

  return "Базовый social graph-контакт без публичного discovery.";
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
