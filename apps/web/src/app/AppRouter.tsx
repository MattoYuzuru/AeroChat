import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { AuthPage } from "../pages/AuthPage";
import { StateScreen } from "../ui/StateScreen";
import { LegacyAppShell } from "./AppShell";
import {
  renderShellAppContent,
  resolveShellRouteEntry,
  routeBackedShellApps,
} from "./app-routes";
import { useDesktopShellViewport } from "../shell/viewport";
import {
  getBrowserShellPreferencesStorage,
  readShellBootPreferences,
  writeShellBootPreferences,
  type ShellBootPreferences,
} from "../shell/preferences";
import {
  readStartMenuRecentItems,
  trackStartMenuRecentWindow,
  writeStartMenuRecentItems,
} from "../shell/start-menu";
import { resolveShellEntrySurface } from "../shell/entry";
import { ShellEntrySurface } from "../shell/ShellEntrySurface";
import { DesktopShell } from "../shell/DesktopShell";
import { MobileLauncherHome } from "../shell/MobileLauncherHome";
import { useEffect, useState } from "react";

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<PublicShellRoute mode="login" />} />
        <Route path="/register" element={<PublicShellRoute mode="register" />} />
        <Route path="/app" element={<ProtectedShellRoute />} />
        {routeBackedShellApps.map((app) => (
          <Route key={app.path} path={app.path} element={<ProtectedShellRoute />} />
        ))}

        <Route path="*" element={<RouteFallback />} />
      </Routes>
    </BrowserRouter>
  );
}

function PublicShellRoute({ mode }: { mode: "login" | "register" }) {
  const auth = useAuth();
  const isDesktopViewport = useDesktopShellViewport();
  const shellEntry = useShellEntryState(auth.state);

  if (auth.state.status === "authenticated") {
    return <Navigate replace to="/app" />;
  }

  if (shellEntry.surface === "boot") {
    return (
      <ShellEntrySurface
        eyebrow="Boot"
        message="Поднимаем gateway-сессию и готовим handoff в auth application."
        surface="boot"
        title="Запуск AeroChat"
      />
    );
  }

  if (shellEntry.surface === "chooser") {
    return (
      <ShellEntrySurface
        eyebrow="Boot chooser"
        message="Выберите preset для текущего запуска. В этом slice тема остаётся одной, но boot model уже различает chooser, fast-entry и reboot path."
        surface="chooser"
        title="System Configuration"
        actions={
          <>
            <button
              onClick={shellEntry.completeChooser}
              style={surfaceButtonStyle}
              type="button"
            >
              XP Aero
            </button>
            {isDesktopViewport && (
              <button
                onClick={shellEntry.skipChooserForNow}
                style={surfaceButtonStyle}
                type="button"
              >
                OS2 Aero
              </button>
            )}
            {isDesktopViewport && (
              <button
                onClick={shellEntry.skipChooserForNow}
                style={surfaceButtonStyle}
                type="button"
              >
                OS3 Aero
              </button>
            )}
            <button
              onClick={shellEntry.completeChooser}
              style={surfaceGhostButtonStyle}
              type="button"
            >
              Continue to {mode === "login" ? "login" : "register"}
            </button>
            {isDesktopViewport && (
              <button
                onClick={shellEntry.skipChooserForNow}
                style={surfaceGhostButtonStyle}
                type="button"
              >
                Random
              </button>
            )}
          </>
        }
      />
    );
  }

  if (shellEntry.surface === "error" && auth.state.status === "error") {
    return (
      <StateScreen
        eyebrow="Session bootstrap"
        message={auth.state.message}
        primaryAction={{
          label: "Повторить",
          onClick: () => {
            void auth.retryBootstrap();
          },
        }}
        secondaryAction={{
          label: "Очистить локальную сессию",
          onClick: auth.discardSession,
        }}
        title="Сессию не удалось восстановить"
        tone="error"
      />
    );
  }

  return <AuthPage mode={mode} />;
}

function ProtectedShellRoute() {
  const auth = useAuth();
  const location = useLocation();
  const isDesktopViewport = useDesktopShellViewport();
  const shellEntry = useShellEntryState(auth.state);
  const routeEntry = resolveShellRouteEntry(location.pathname, location.search);
  const [storage] = useState(() => getBrowserShellPreferencesStorage());

  useEffect(() => {
    if (auth.state.status !== "authenticated" || isDesktopViewport || routeEntry === null) {
      return;
    }

    const currentItems = readStartMenuRecentItems(storage);
    const nextItems = trackStartMenuRecentWindow(currentItems, {
      appId: routeEntry.app.appId,
      title: routeEntry.target?.title ?? routeEntry.app.title,
      routePath: routeEntry.target?.routePath ?? routeEntry.app.routePath,
      target: routeEntry.target,
    });

    if (nextItems === currentItems) {
      return;
    }

    writeStartMenuRecentItems(storage, nextItems);
  }, [
    auth.state.status,
    isDesktopViewport,
    location.pathname,
    location.search,
    routeEntry,
    storage,
  ]);

  if (auth.state.status === "anonymous") {
    return <Navigate replace to="/login" />;
  }

  if (shellEntry.surface === "boot") {
    return (
      <ShellEntrySurface
        eyebrow="Boot"
        message="Определяем, нужен ли chooser или можно войти в shell напрямую."
        surface="boot"
        title="Подготовка desktop shell"
      />
    );
  }

  if (shellEntry.surface === "chooser") {
    return (
      <ShellEntrySurface
        eyebrow="Boot chooser"
        message="Explicit reboot-to-boot flow требует подтверждения текущего desktop preset перед возвратом в shell."
        surface="chooser"
        title="Boot Options"
        actions={
          <>
            <button
              onClick={shellEntry.completeChooser}
              style={surfaceButtonStyle}
              type="button"
            >
              XP Aero
            </button>
            <button
              onClick={shellEntry.completeChooser}
              style={surfaceGhostButtonStyle}
              type="button"
            >
              Continue to desktop
            </button>
          </>
        }
      />
    );
  }

  if (shellEntry.surface === "error" && auth.state.status === "error") {
    return (
      <StateScreen
        eyebrow="Gateway session"
        message={auth.state.message}
        primaryAction={{
          label: "Повторить",
          onClick: () => {
            void auth.retryBootstrap();
          },
        }}
        secondaryAction={{
          label: "Очистить локальную сессию",
          onClick: auth.discardSession,
        }}
        title="Сессия требует внимания"
        tone="error"
      />
    );
  }

  if (auth.state.status !== "authenticated") {
    return null;
  }

  if (isDesktopViewport) {
    return <DesktopShell onRequestRebootToBoot={shellEntry.requestRebootToBoot} />;
  }

  if (location.pathname === "/app") {
    return (
      <LegacyAppShell>
        <MobileLauncherHome />
      </LegacyAppShell>
    );
  }

  if (routeEntry === null) {
    return <Navigate replace to="/app" />;
  }

  return <LegacyAppShell>{renderShellAppContent(routeEntry.app.appId)}</LegacyAppShell>;
}

function RouteFallback() {
  const { state } = useAuth();

  if (state.status === "authenticated") {
    return <Navigate replace to="/app" />;
  }

  if (state.status === "bootstrapping") {
    return (
      <StateScreen
        eyebrow="AeroChat"
        message="Определяем точку входа для текущей сессии."
        title="Маршрутизация"
      />
    );
  }

  return <Navigate replace to="/login" />;
}

function useShellEntryState(authState: ReturnType<typeof useAuth>["state"]) {
  const [storage] = useState(() => getBrowserShellPreferencesStorage());
  const [preferences, setPreferences] = useState<ShellBootPreferences>(() =>
    readShellBootPreferences(storage),
  );
  const [bootVisible, setBootVisible] = useState(true);
  const [bootCycleToken, setBootCycleToken] = useState(0);

  useEffect(() => {
    if (authState.status === "bootstrapping") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setBootVisible(false);
    }, 360);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [authState.status, bootCycleToken]);

  function updatePreferences(nextPreferences: ShellBootPreferences) {
    setPreferences(nextPreferences);
    writeShellBootPreferences(storage, nextPreferences);
  }

  function completeChooser() {
    updatePreferences({
      chooserCompleted: true,
      rebootToBoot: false,
    });
  }

  function skipChooserForNow() {
    completeChooser();
  }

  function requestRebootToBoot() {
    updatePreferences({
      ...preferences,
      rebootToBoot: true,
    });
    setBootVisible(true);
    setBootCycleToken((current) => current + 1);
  }

  return {
    surface: resolveShellEntrySurface({
      authState,
      bootVisible,
      preferences,
    }),
    completeChooser,
    skipChooserForNow,
    requestRebootToBoot,
    preferences,
  };
}

const surfaceButtonStyle = {
  minHeight: "2.6rem",
  padding: "0.62rem 0.9rem",
  border: "1px solid #5c6f80",
  color: "#edf4ee",
  background: "linear-gradient(180deg, #0f1922, #071017)",
  boxShadow: "inset 1px 1px 0 rgba(255, 255, 255, 0.08)",
  cursor: "pointer",
  fontFamily: '"Lucida Console", "Courier New", monospace',
  textAlign: "left" as const,
};

const surfaceGhostButtonStyle = {
  minHeight: "2.6rem",
  padding: "0.62rem 0.9rem",
  border: "1px solid #6d7f8f",
  color: "#c3ceca",
  background: "linear-gradient(180deg, rgba(20, 31, 41, 0.95), rgba(7, 14, 20, 0.95))",
  boxShadow: "inset 1px 1px 0 rgba(255, 255, 255, 0.06)",
  cursor: "pointer",
  fontFamily: '"Lucida Console", "Courier New", monospace',
  textAlign: "left" as const,
};
