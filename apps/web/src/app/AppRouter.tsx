import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { AuthPage } from "../pages/AuthPage";
import { StateScreen } from "../ui/StateScreen";
import {
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
import { useEffect, useState } from "react";
import { RetryableLazyModule } from "./lazy-module";
import { createLazyModule } from "./lazy-module-loader";
import { renderShellAppContent } from "./app-content";

import DesktopShellResource from "virtual:aerochat-lazy-url/DesktopShell";
import AppShellResource from "virtual:aerochat-lazy-url/AppShell";
import MobileLauncherHomeResource from "virtual:aerochat-lazy-url/MobileLauncherHome";

const desktopModule = createLazyModule<{ onRequestRebootToBoot(): void }>(
  () => import("../shell/DesktopShell").then(({ DesktopShell }) => ({ default: DesktopShell })),
  DesktopShellResource, "DesktopShell",
);
const legacyModule = createLazyModule<{ children: import("react").ReactNode }>(
  () => import("./AppShell").then(({ LegacyAppShell }) => ({ default: LegacyAppShell })),
  AppShellResource, "LegacyAppShell",
);
const launcherModule = createLazyModule<Record<string, never>>(
  () => import("../shell/MobileLauncherHome").then(({ MobileLauncherHome }) => ({ default: MobileLauncherHome })),
  MobileLauncherHomeResource, "MobileLauncherHome",
);

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
  const shellEntry = useShellEntryState(auth.state);

  if (auth.state.status === "authenticated") {
    return <Navigate replace to="/app" />;
  }

  if (shellEntry.surface === "boot") {
    return (
      <ShellEntrySurface
        eyebrow="AeroChat"
        message="Проверяем сессию. Сейчас откроется экран входа."
        surface="boot"
        title="Запуск AeroChat"
      />
    );
  }

  if (shellEntry.surface === "chooser") {
    return (
      <ShellEntrySurface
        eyebrow="Оформление"
        message="Оформление XP Aero готово. Продолжите, чтобы войти в AeroChat."
        surface="chooser"
        title="XP Aero"
        actions={
          <button
            onClick={shellEntry.completeChooser}
            style={surfaceButtonStyle}
            type="button"
          >
            Продолжить
          </button>
        }
      />
    );
  }

  if (shellEntry.surface === "error" && auth.state.status === "error") {
    return (
      <StateScreen
        eyebrow="Вход в AeroChat"
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
        eyebrow="AeroChat"
        message="Проверяем сессию и открываем AeroChat."
        surface="boot"
        title="Запуск AeroChat"
      />
    );
  }

  if (shellEntry.surface === "chooser") {
    return (
      <ShellEntrySurface
        eyebrow="Оформление"
        message="Оформление XP Aero готово. Продолжите, чтобы вернуться в AeroChat."
        surface="chooser"
        title="XP Aero"
        actions={
          <button
            onClick={shellEntry.completeChooser}
            style={surfaceButtonStyle}
            type="button"
          >
            Продолжить
          </button>
        }
      />
    );
  }

  if (shellEntry.surface === "error" && auth.state.status === "error") {
    return (
      <StateScreen
        eyebrow="Вход в AeroChat"
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
    return <RetryableLazyModule descriptor={desktopModule} title="Рабочий стол" moduleProps={{ onRequestRebootToBoot: shellEntry.requestRebootToBoot }} />;
  }

  if (location.pathname === "/app") {
    return (
      <RetryableLazyModule
        descriptor={legacyModule}
        title="Мобильное приложение"
        moduleProps={{ children: <RetryableLazyModule descriptor={launcherModule} title="Приложения" moduleProps={{}} /> }}
      />
    );
  }

  if (routeEntry === null) {
    return <Navigate replace to="/app" />;
  }

  return <RetryableLazyModule descriptor={legacyModule} title="Мобильное приложение" moduleProps={{ children: renderShellAppContent(routeEntry.app.appId) }} />;
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
        message="Проверяем сессию и открываем AeroChat."
        title="Запуск AeroChat"
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
