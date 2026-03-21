import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { AppShell } from "./AppShell";
import { AuthPage } from "../pages/AuthPage";
import { ProfilePage } from "../pages/ProfilePage";
import { PeoplePage } from "../pages/PeoplePage";
import { ChatsPage } from "../pages/ChatsPage";
import { GroupsPage } from "../pages/GroupsPage";
import { StateScreen } from "../ui/StateScreen";
import { SettingsPage } from "../pages/SettingsPage";
import { SearchPage } from "../pages/SearchPage";

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<PublicRoute />}>
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route path="/app" element={<AppShell />}>
            <Route index element={<Navigate replace to="profile" />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="chats" element={<ChatsPage />} />
            <Route path="groups" element={<GroupsPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="people" element={<PeoplePage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>

        <Route path="*" element={<RouteFallback />} />
      </Routes>
    </BrowserRouter>
  );
}

function PublicRoute() {
  const { state, retryBootstrap, discardSession } = useAuth();

  if (state.status === "bootstrapping") {
    return (
      <StateScreen
        eyebrow="AeroChat"
        message="Проверяем сохранённую gateway-сессию и поднимаем текущий профиль."
        title="Загрузка сессии"
      />
    );
  }

  if (state.status === "authenticated") {
    return <Navigate replace to="/app/profile" />;
  }

  if (state.status === "error") {
    return (
      <StateScreen
        eyebrow="Session bootstrap"
        message={state.message}
        primaryAction={{
          label: "Повторить",
          onClick: () => {
            void retryBootstrap();
          },
        }}
        secondaryAction={{
          label: "Очистить локальную сессию",
          onClick: discardSession,
        }}
        title="Сессию не удалось восстановить"
        tone="error"
      />
    );
  }

  return <Outlet />;
}

function ProtectedRoute() {
  const { state, retryBootstrap, discardSession } = useAuth();

  if (state.status === "bootstrapping") {
    return (
      <StateScreen
        eyebrow="AeroChat"
        message="Проверяем сохранённую gateway-сессию и поднимаем текущий профиль."
        title="Загрузка workspace"
      />
    );
  }

  if (state.status === "error") {
    return (
      <StateScreen
        eyebrow="Gateway session"
        message={state.message}
        primaryAction={{
          label: "Повторить",
          onClick: () => {
            void retryBootstrap();
          },
        }}
        secondaryAction={{
          label: "Очистить локальную сессию",
          onClick: discardSession,
        }}
        title="Сессия требует внимания"
        tone="error"
      />
    );
  }

  if (state.status === "anonymous") {
    return <Navigate replace to="/login" />;
  }

  return <Outlet />;
}

function RouteFallback() {
  const { state } = useAuth();

  if (state.status === "authenticated") {
    return <Navigate replace to="/app/profile" />;
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
