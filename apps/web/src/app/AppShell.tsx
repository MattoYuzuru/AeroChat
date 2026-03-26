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
  "связь",
  "главный экран",
  "личный чат",
  "группы",
  "профиль",
  "люди",
  "чаты",
  "поиск",
  "заявки",
  "настройки",
];

const mobileNavigationItems = navigationItems.filter(
  (item) =>
    item.to === "/app" ||
    item.to === "/app/chats" ||
    item.to === "/app/groups" ||
    item.to === "/app/search" ||
    item.to === "/app/settings",
);

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
  const isHome = location.pathname === "/app";
  const activeNavigationItem =
    navigationItems.find((item) =>
      item.exact === true
        ? location.pathname === item.to
        : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`),
    ) ?? null;
  const currentTitle = isHome ? "AeroChat" : activeNavigationItem?.label ?? "Раздел";
  const currentSubtitle = isHome
    ? `@${state.profile.login} · ${state.profile.nickname}`
    : activeNavigationItem?.meta ?? "Мобильный раздел";

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
        <div className={styles.headerBar}>
          <button
            className={styles.headerButton}
            onClick={() => {
              if (isHome) {
                navigate("/app/search");
                return;
              }

              if (window.history.length > 1) {
                navigate(-1);
                return;
              }

              navigate("/app");
            }}
            type="button"
          >
            {isHome ? "Поиск" : "Назад"}
          </button>

          <div className={styles.headerCopy}>
            <p className={styles.eyebrow}>{isHome ? "Мобильный режим" : "AeroChat"}</p>
            <h1 className={styles.title}>{currentTitle}</h1>
            <p className={styles.subtitle}>{currentSubtitle}</p>
          </div>

          <button
            className={styles.headerButton}
            disabled={isLoggingOut}
            onClick={() => {
              if (isHome) {
                void handleLogout();
                return;
              }

              navigate("/app");
            }}
            type="button"
          >
            {isHome ? (isLoggingOut ? "Выход..." : "Выйти") : "Домой"}
          </button>
        </div>

        {isHome && (
          <div className={styles.statusCluster}>
            {statusItems.slice(0, 4).map((item) => (
              <span key={item} className={styles.statusChip}>
                {item}
              </span>
            ))}
          </div>
        )}

        {logoutError && <p className={styles.logoutError}>{logoutError}</p>}
      </header>

      {visibleDirectCallSurface && (
        <section className={styles.callSurface}>
          <div>
            <p className={styles.callSurfaceLabel}>Активный звонок</p>
            <h2 className={styles.callSurfaceTitle}>
              {visibleDirectCallPeer?.nickname ?? "Личный чат"}
            </h2>
            <p className={styles.callSurfaceText}>
              {canReturnToCall
                ? "Звонок ещё активен. Можно быстро вернуться в чат и снова подключиться."
                : "В одном из личных чатов идёт активный звонок. Можно сразу присоединиться."}
            </p>
          </div>

          <div className={styles.callSurfaceActions}>
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

      <main className={styles.contentArea}>
        <div className={styles.contentWindow}>
          <div className={styles.windowBody}>{children}</div>
        </div>
      </main>

      <nav className={styles.navList} aria-label="Основные разделы">
        {mobileNavigationItems.map((item) => (
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
      <div className={styles.safeArea} aria-hidden="true" />
    </div>
  );
}
