import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { AppShell } from "./AppShell";
import { AuthPage } from "../pages/AuthPage";
import { ProfilePage } from "../pages/ProfilePage";
import { SectionPlaceholder } from "../pages/SectionPlaceholder";
import { StateScreen } from "../ui/StateScreen";

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
            <Route
              path="chats"
              element={
                <SectionPlaceholder
                  title="Чаты"
                  description="Полный direct chat UI пока не входит в этот PR. В shell остаётся только навигационный слот под следующий vertical slice."
                  nextSlice="Следующий PR: первый chat list / direct thread foundation через gateway."
                />
              }
            />
            <Route
              path="people"
              element={
                <SectionPlaceholder
                  title="Люди"
                  description="Friends UI и social graph actions пока не поднимаются во frontend, чтобы не смешивать auth bootstrap с отдельным social slice."
                  nextSlice="Следующий PR: gateway-driven social graph read actions и friend requests UI."
                />
              }
            />
            <Route
              path="settings"
              element={
                <SectionPlaceholder
                  title="Настройки"
                  description="Отдельное settings-приложение и desktop window system остаются за пределами текущего bootstrap."
                  nextSlice="Следующий PR: settings shell и дополнительные identity/session controls."
                />
              }
            />
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
