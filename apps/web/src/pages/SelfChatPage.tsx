import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { useDesktopShellHost } from "../shell/context";
import type { ShellAppId } from "../shell/runtime";
import styles from "./SelfChatPage.module.css";

export function SelfChatPage() {
  const navigate = useNavigate();
  const desktopShellHost = useDesktopShellHost();
  const { state } = useAuth();

  if (state.status !== "authenticated") {
    return null;
  }

  function openShellApp(appId: ShellAppId, routePath: string) {
    if (desktopShellHost !== null) {
      desktopShellHost.launchApp(appId);
    }

    navigate(routePath);
  }

  return (
    <div className={styles.layout}>
      <section className={styles.heroCard}>
        <div className={styles.heroHeader}>
          <div>
            <p className={styles.cardLabel}>Self Chat</p>
            <h1 className={styles.title}>Я</h1>
            <p className={styles.subtitle}>
              Канонический self-facing shell target для текущего пользователя. В текущей модели
              продукта backend не поддерживает self-direct thread, поэтому это окно честно
              объединяет ваши профильные и account entrypoints без fake chat semantics.
            </p>
          </div>

          <div className={styles.actions}>
            <button
              className={styles.primaryButton}
              onClick={() => {
                openShellApp("profile", "/app/profile");
              }}
              type="button"
            >
              Профиль
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() => {
                openShellApp("settings", "/app/settings");
              }}
              type="button"
            >
              Настройки
            </button>
          </div>
        </div>

        <div className={styles.identityCard}>
          <div className={styles.identityBadge} aria-hidden="true">
            {getInitial(state.profile.nickname, state.profile.login)}
          </div>

          <div className={styles.identityBody}>
            <h2 className={styles.identityTitle}>{state.profile.nickname}</h2>
            <p className={styles.identitySubtitle}>@{state.profile.login}</p>
            <p className={styles.identitySummary}>
              {state.profile.statusText?.trim() ||
                state.profile.bio?.trim() ||
                "Self Chat остаётся быстрым входом в ваши account surfaces и текущий shell context."}
            </p>
          </div>
        </div>

        <div className={styles.metrics}>
          <Metric label="Профиль обновлён" value={formatDateTime(state.profile.updatedAt)} />
          <Metric label="Резерв ключей" value={state.profile.keyBackupStatus} />
          <Metric label="Timezone" value={state.profile.timezone?.trim() || "не задан"} />
        </div>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <p className={styles.cardLabel}>Быстрые переходы</p>
          <h2 className={styles.panelTitle}>Текущие self entrypoints</h2>
          <p className={styles.panelText}>
            `Я` теперь открывается как route-backed singleton window и остаётся стабильной точкой
            входа для вашего account workspace в shell и на mobile.
          </p>

          <div className={styles.quickActions}>
            <QuickActionCard
              description="Редактирование базовой profile card текущего пользователя."
              label="Открыть профиль"
              onClick={() => {
                openShellApp("profile", "/app/profile");
              }}
            />
            <QuickActionCard
              description="Privacy flags, devices, sessions, timezone и accent."
              label="Открыть настройки"
              onClick={() => {
                openShellApp("settings", "/app/settings");
              }}
            />
            <QuickActionCard
              description="Входящие и исходящие friend requests без дублирования окна."
              label="Открыть заявки"
              onClick={() => {
                openShellApp("friend_requests", "/app/friend-requests");
              }}
            />
            <QuickActionCard
              description="Переход в текущий direct chat workspace и existing chat flows."
              label="Открыть чаты"
              onClick={() => {
                openShellApp("chats", "/app/chats");
              }}
            />
          </div>
        </article>

        <article className={styles.panel}>
          <p className={styles.cardLabel}>Текущий контекст</p>
          <h2 className={styles.panelTitle}>Что reuse'ится без нового backend slice</h2>

          <dl className={styles.metaList}>
            <div>
              <dt>Login</dt>
              <dd>@{state.profile.login}</dd>
            </div>
            <div>
              <dt>Статус</dt>
              <dd>{state.profile.statusText?.trim() || "не задан"}</dd>
            </div>
            <div>
              <dt>Accent</dt>
              <dd>{state.profile.profileAccent?.trim() || "по умолчанию"}</dd>
            </div>
            <div>
              <dt>Город</dt>
              <dd>{state.profile.city?.trim() || "не указан"}</dd>
            </div>
            <div>
              <dt>Страна</dt>
              <dd>{state.profile.country?.trim() || "не указана"}</dd>
            </div>
            <div>
              <dt>Создан</dt>
              <dd>{formatDateTime(state.profile.createdAt)}</dd>
            </div>
          </dl>

          <div className={styles.noticeCard}>
            <p className={styles.noticeTitle}>Почему здесь нет self-direct thread</p>
            <p className={styles.noticeText}>
              Chat domain сейчас разрешает direct chats только между друзьями и явно блокирует
              создание чата с самим собой. Поэтому `Я` в этом PR остаётся настоящим shell target,
              но не симулирует несуществующий backend conversation.
            </p>
            <button
              className={styles.secondaryButton}
              onClick={() => {
                openShellApp("search", "/app/search");
              }}
              type="button"
            >
              Открыть поиск
            </button>
          </div>
        </article>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className={styles.metricCard}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function QuickActionCard({
  description,
  label,
  onClick,
}: {
  description: string;
  label: string;
  onClick(): void;
}) {
  return (
    <button className={styles.quickActionCard} onClick={onClick} type="button">
      <strong>{label}</strong>
      <span>{description}</span>
    </button>
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

function getInitial(nickname: string, login: string): string {
  const source = nickname.trim() || login.trim() || "Я";
  return source.slice(0, 1).toUpperCase();
}
