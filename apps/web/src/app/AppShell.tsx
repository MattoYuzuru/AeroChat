import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useState, type PropsWithChildren } from "react";
import { getAuthErrorMessage, useAuth } from "../auth/useAuth";
import { selectVisibleDirectCallSurfaceEntry } from "../rtc/awareness";
import { useDirectCallAwareness } from "../rtc/useDirectCallAwareness";
import styles from "./AppShell.module.css";

const navigationItems = [
  { to: "/app", label: "Домой", meta: "Пуск", exact: true },
  { to: "/app/self", label: "Я", meta: "Личное" },
  { to: "/app/group-creator", label: "Создать группу", meta: "Новая группа" },
  { to: "/app/profile", label: "Профиль", meta: "Учётная запись" },
  { to: "/app/chats", label: "Чаты", meta: "Личные переписки" },
  { to: "/app/groups", label: "Группы", meta: "Групповые переписки" },
  { to: "/app/explorer", label: "Проводник", meta: "Ярлыки и папки" },
  { to: "/app/search", label: "Поиск", meta: "Сообщения и люди" },
  { to: "/app/friend-requests", label: "Заявки", meta: "Запросы" },
  { to: "/app/people", label: "Люди", meta: "Контакты" },
  { to: "/app/settings", label: "Настройки", meta: "Параметры" },
];

const statusItems = [
  "gateway edge",
  "launcher home",
  "self chat",
  "group creator",
  "profile",
  "people",
  "direct chats",
  "groups",
  "explorer",
  "search",
  "friend requests",
  "settings",
];

export function LegacyAppShell({ children }: PropsWithChildren) {
  const location = useLocation();
  const navigate = useNavigate();
  const { state, logout } = useAuth();
  const directCallAwareness = useDirectCallAwareness();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  if (state.status !== "authenticated") {
    return null;
  }

  async function handleLogout() {
    setIsLoggingOut(true);
    setLogoutError(null);

    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (error) {
      setLogoutError(
        getAuthErrorMessage(error, "Не удалось завершить текущую сессию."),
      );
    } finally {
      setIsLoggingOut(false);
    }
  }

  const currentSearchParams = new URLSearchParams(location.search);
  const currentChatId =
    location.pathname === "/app/chats"
      ? currentSearchParams.get("chat")?.trim() ?? null
      : null;
  const visibleDirectCallSurface = selectVisibleDirectCallSurfaceEntry(
    directCallAwareness.state,
    currentChatId,
  );
  const visibleDirectCallPeer =
    visibleDirectCallSurface === null
      ? null
      : visibleDirectCallSurface.chat.participants.find(
          (participant) => participant.id !== state.profile.id,
        ) ?? null;
  const canReturnToCall =
    visibleDirectCallSurface?.participants.some(
      (participant) =>
        participant.userId === state.profile.id && participant.state === "active",
    ) ?? false;

  function openDirectCallThread(withJoinIntent: boolean) {
    if (visibleDirectCallSurface === null) {
      return;
    }

    const nextParams = new URLSearchParams();
    nextParams.set("chat", visibleDirectCallSurface.chat.id);
    if (withJoinIntent) {
      nextParams.set("call", canReturnToCall ? "return" : "join");
    }

    navigate(`/app/chats?${nextParams.toString()}`);
  }

  return (
    <div className={styles.shell}>
      <div className={styles.backdrop} aria-hidden="true" />

      <header className={styles.topBar}>
        <div>
          <p className={styles.eyebrow}>AeroChat</p>
          <h1 className={styles.title}>Лёгкий glossy workspace</h1>
          <p className={styles.subtitle}>
            Текущий пользователь: <strong>{state.profile.nickname}</strong> · @{state.profile.login}
          </p>
        </div>

        <div className={styles.topBarAside}>
          <div className={styles.statusCluster}>
            {statusItems.map((item) => (
              <span key={item} className={styles.statusChip}>
                {item}
              </span>
            ))}
          </div>
          <button
            className={styles.logoutButton}
            disabled={isLoggingOut}
            onClick={handleLogout}
            type="button"
          >
            {isLoggingOut ? "Выход..." : "Выйти"}
          </button>
          {logoutError && <p className={styles.logoutError}>{logoutError}</p>}
        </div>
      </header>

      {visibleDirectCallSurface && (
        <section className={styles.callSurface}>
          <div>
            <p className={styles.callSurfaceLabel}>Активный direct call</p>
            <h2 className={styles.callSurfaceTitle}>
              {visibleDirectCallPeer?.nickname ?? "Direct chat"}
            </h2>
            <p className={styles.callSurfaceText}>
              {canReturnToCall
                ? "Звонок ещё активен на сервере. Можно быстро вернуться в direct thread и заново поднять локальную audio session."
                : "В одном из direct chats идёт активный аудиозвонок. Можно открыть thread или явно присоединиться."}
            </p>
          </div>

          <div className={styles.callSurfaceActions}>
            <button
              className={styles.surfaceGhostButton}
              onClick={() => {
                openDirectCallThread(false);
              }}
              type="button"
            >
              Открыть чат
            </button>
            <button
              className={styles.surfacePrimaryButton}
              onClick={() => {
                openDirectCallThread(true);
              }}
              type="button"
            >
              {canReturnToCall ? "Вернуться в звонок" : "Присоединиться"}
            </button>
            <button
              className={styles.surfaceGhostButton}
              onClick={() => {
                directCallAwareness.dismissSurface(
                  visibleDirectCallSurface.chat.id,
                  visibleDirectCallSurface.call.id,
                );
              }}
              type="button"
            >
              Скрыть
            </button>
          </div>
        </section>
      )}

      <main className={styles.workspace}>
        <aside className={styles.sidebar}>
          <section className={styles.sidebarCard}>
            <p className={styles.panelLabel}>Навигация</p>
            <nav className={styles.navList} aria-label="Основные разделы">
              {navigationItems.map((item) => (
                <NavLink
                  end={item.exact === true}
                  key={item.to}
                  className={({ isActive }) =>
                    isActive ? styles.navItemActive : styles.navItem
                  }
                  to={item.to}
                >
                  <span>{item.label}</span>
                  <small>{item.meta}</small>
                </NavLink>
              ))}
            </nav>
          </section>

          <section className={styles.sidebarCard}>
            <p className={styles.panelLabel}>Контур</p>
            <dl className={styles.metaGrid}>
              <div>
                <dt>Edge</dt>
                <dd>`/api` + `/api/realtime` → `aero-gateway`</dd>
              </div>
              <div>
                <dt>Auth</dt>
                <dd>sessionStorage bootstrap</dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>login, register, group creator, profile, people, chats, groups, search, settings</dd>
              </div>
            </dl>
          </section>
        </aside>

        <section className={styles.contentArea}>
          <div className={styles.contentWindow}>
            <div className={styles.windowHeader}>
              <span className={styles.windowDot} />
              <span className={styles.windowDot} />
              <span className={styles.windowDot} />
              <span className={styles.windowTitle}>apps/web</span>
            </div>

            <div className={styles.windowBody}>
              {children}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
