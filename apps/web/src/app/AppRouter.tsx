import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { AuthPage } from "../pages/AuthPage";
import { StateScreen } from "../ui/StateScreen";
import { LegacyAppShell } from "./AppShell";
import { renderShellAppContent, resolveRouteBackedShellApp, routeBackedShellApps } from "./app-routes";
import { useDesktopShellViewport } from "../shell/viewport";
import {
  getBrowserShellPreferencesStorage,
  readShellBootPreferences,
  writeShellBootPreferences,
  type ShellBootPreferences,
} from "../shell/preferences";
import { resolveShellEntrySurface } from "../shell/entry";
import { ShellEntrySurface } from "../shell/ShellEntrySurface";
import { DesktopShell } from "../shell/DesktopShell";
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
        message="Поднимаем gateway-сессию и готовим shell handoff."
        title="Запуск AeroChat"
      />
    );
  }

  if (shellEntry.surface === "chooser") {
    return (
      <ShellEntrySurface
        eyebrow="Boot chooser"
        message="Этот BIOS-like chooser нужен для first-run и explicit reboot-to-boot path. В этом slice тема ещё одна, но shell runtime уже различает chooser и daily fast-entry."
        title="Shell chooser"
        actions={
          <>
            <button
              onClick={shellEntry.completeChooser}
              style={surfaceButtonStyle}
              type="button"
            >
              Продолжить в {mode === "login" ? "логин" : "регистрацию"}
            </button>
            {isDesktopViewport && (
              <button
                onClick={shellEntry.skipChooserForNow}
                style={surfaceGhostButtonStyle}
                type="button"
              >
                Отложить chooser gate
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
  const routeApp = resolveRouteBackedShellApp(location.pathname);

  if (auth.state.status === "anonymous") {
    return <Navigate replace to="/login" />;
  }

  if (shellEntry.surface === "boot") {
    return (
      <ShellEntrySurface
        eyebrow="Boot"
        message="Определяем, нужен ли chooser или можно войти в shell напрямую."
        title="Подготовка desktop shell"
      />
    );
  }

  if (shellEntry.surface === "chooser") {
    return (
      <ShellEntrySurface
        eyebrow="Boot chooser"
        message="Explicit reboot-to-boot flow или first-run ещё не завершён. Продолжение вернёт в desktop shell без отдельной theme logic в этом PR."
        title="Shell chooser"
        actions={
          <button
            onClick={shellEntry.completeChooser}
            style={surfaceButtonStyle}
            type="button"
          >
            Продолжить в desktop
          </button>
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
    return <Navigate replace to="/app/profile" />;
  }

  if (routeApp === null) {
    return <Navigate replace to="/app/profile" />;
  }

  return <LegacyAppShell>{renderShellAppContent(routeApp.appId)}</LegacyAppShell>;
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
  minHeight: "2.75rem",
  padding: "0.72rem 1rem",
  border: "1px solid rgba(255, 255, 255, 0.24)",
  borderRadius: "999px",
  color: "#ffffff",
  background: "linear-gradient(180deg, #43a6f0, #0d5e9c)",
  boxShadow: "var(--shadow-button)",
  cursor: "pointer",
};

const surfaceGhostButtonStyle = {
  minHeight: "2.75rem",
  padding: "0.72rem 1rem",
  border: "1px solid rgba(255, 255, 255, 0.44)",
  borderRadius: "999px",
  background: "rgba(255, 255, 255, 0.76)",
  boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.78)",
  cursor: "pointer",
};
