import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useState } from "react";
import { getAuthErrorMessage, useAuth } from "../auth/useAuth";
import styles from "./AppShell.module.css";

const navigationItems = [
  { to: "/app/profile", label: "Профиль", meta: "identity" },
  { to: "/app/chats", label: "Чаты", meta: "future" },
  { to: "/app/people", label: "Люди", meta: "future" },
  { to: "/app/settings", label: "Настройки", meta: "future" },
];

const statusItems = [
  "gateway-only edge",
  "session bootstrap",
  "protected shell",
];

export function AppShell() {
  const navigate = useNavigate();
  const { state, logout } = useAuth();
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

  return (
    <div className={styles.shell}>
      <div className={styles.backdrop} aria-hidden="true" />

      <header className={styles.topBar}>
        <div>
          <p className={styles.eyebrow}>AeroChat</p>
          <h1 className={styles.title}>Gateway-authenticated workspace</h1>
          <p className={styles.subtitle}>
            Текущий пользователь: <strong>{state.profile.nickname}</strong> · @
            {state.profile.login}
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

      <main className={styles.workspace}>
        <aside className={styles.sidebar}>
          <section className={styles.sidebarCard}>
            <p className={styles.panelLabel}>Навигация</p>
            <nav className={styles.navList} aria-label="Основные разделы">
              {navigationItems.map((item) => (
                <NavLink
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
                <dd>`/api` → aero-gateway</dd>
              </div>
              <div>
                <dt>Auth</dt>
                <dd>sessionStorage bootstrap</dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>login, register, profile, shell</dd>
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
              <Outlet />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
