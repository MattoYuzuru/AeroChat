import {
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getAuthErrorMessage, useAuth } from "../auth/useAuth";
import {
  buildDirectChatShellTarget,
  buildGroupChatShellTarget,
  buildPersonProfileShellTarget,
  isRouteBackedShellAppId,
  renderShellAppContent,
  resolveShellRouteEntry,
  shellAppRegistry,
} from "../app/app-routes";
import { selectVisibleDirectCallSurfaceEntry } from "../rtc/awareness";
import { useDirectCallAwareness } from "../rtc/useDirectCallAwareness";
import { DesktopShellHostContext } from "./context";
import {
  buildShellLaunchKey,
  createInitialShellRuntimeState,
  getDefaultShellWindowContentMode,
  listTaskbarShellWindows,
  selectActiveShellWindow,
  shellRuntimeReducer,
  type ShellAppId,
  type ShellWindowContentMode,
  type ShellWindow,
} from "./runtime";
import styles from "./DesktopShell.module.css";

const desktopEntryItems: Array<{
  appId: ShellAppId;
  label: string;
  meta: string;
}> = [
  { appId: "search", label: "Поиск", meta: "message search" },
  { appId: "settings", label: "Настройки", meta: "privacy" },
  { appId: "self_chat", label: "Я", meta: "self chat" },
  { appId: "friend_requests", label: "Заявки", meta: "social" },
  { appId: "chats", label: "Чаты", meta: "chat opener" },
];

const startMenuItems: Array<{
  appId: ShellAppId;
  description: string;
}> = [
  { appId: "search", description: "Поиск сообщений и быстрый jump в текущие conversations." },
  { appId: "chats", description: "Текущий route-backed direct chat workspace как bridge slice." },
  { appId: "settings", description: "Privacy, devices, sessions и account preferences." },
  { appId: "self_chat", description: "Shell-native placeholder для будущего канонического Я-чата." },
  {
    appId: "friend_requests",
    description: "Shell-native placeholder для выделенного системного app заявок.",
  },
];

export function DesktopShell({
  onRequestRebootToBoot,
}: {
  onRequestRebootToBoot(): void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { state, logout } = useAuth();
  const directCallAwareness = useDirectCallAwareness();
  const [runtimeState, dispatch] = useReducer(
    shellRuntimeReducer,
    undefined,
    createInitialShellRuntimeState,
  );
  const [isStartOpen, setIsStartOpen] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClock(new Date());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const routeEntry = useMemo(
    () => resolveShellRouteEntry(location.pathname, location.search),
    [location.pathname, location.search],
  );

  useEffect(() => {
    if (routeEntry === null) {
      return;
    }

    dispatch({
      type: "launch",
      app: routeEntry.app,
      target: routeEntry.target,
    });
  }, [routeEntry]);

  const activeWindow = selectActiveShellWindow(runtimeState);

  useEffect(() => {
    const desiredPath = activeWindow?.routePath ?? "/app";
    const currentPath = `${location.pathname}${location.search}`;
    if (desiredPath === currentPath) {
      return;
    }

    navigate(desiredPath, { replace: true });
  }, [activeWindow?.routePath, location.pathname, location.search, navigate]);

  if (state.status !== "authenticated") {
    return null;
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

  function launchApp(appId: ShellAppId) {
    const app = shellAppRegistry[appId];
    const routeTarget =
      app.routePath === null
        ? null
        : {
            key: app.appId,
            title: app.title,
            routePath: app.routePath,
          };

    dispatch({
      type: "launch",
      app,
      target: routeTarget,
    });
    setIsStartOpen(false);

    if (routeTarget?.routePath) {
      navigate(routeTarget.routePath);
    }
  }

  function openDirectChat(options: {
    chatId: string;
    title?: string;
    searchParams?: URLSearchParams | null;
  }) {
    const target = buildDirectChatShellTarget(options);
    dispatch({
      type: "launch",
      app: shellAppRegistry.direct_chat,
      target,
    });
    navigate(target.routePath ?? "/app/chats");
    setIsStartOpen(false);
  }

  function openGroupChat(options: {
    groupId: string;
    title?: string;
    searchParams?: URLSearchParams | null;
  }) {
    const target = buildGroupChatShellTarget(options);
    dispatch({
      type: "launch",
      app: shellAppRegistry.group_chat,
      target,
    });
    navigate(target.routePath ?? "/app/groups");
    setIsStartOpen(false);
  }

  function openPersonProfile(options: {
    userId: string;
    title?: string;
    searchParams?: URLSearchParams | null;
  }) {
    const target = buildPersonProfileShellTarget(options);
    dispatch({
      type: "launch",
      app: shellAppRegistry.person_profile,
      target,
    });
    navigate(target.routePath ?? "/app/people");
    setIsStartOpen(false);
  }

  function syncCurrentRouteTitle(title: string) {
    if (routeEntry?.target === null || routeEntry === null) {
      return;
    }

    const normalizedTitle = title.trim();
    if (normalizedTitle === "") {
      return;
    }

    const launchKey = buildShellLaunchKey(routeEntry.app, routeEntry.target);
    const currentWindow =
      runtimeState.windows.find((window) => window.launchKey === launchKey) ?? null;
    if (currentWindow?.title === normalizedTitle) {
      return;
    }

    dispatch({
      type: "sync_target",
      app: routeEntry.app,
      target: {
        ...routeEntry.target,
        title: normalizedTitle,
        routePath: `${location.pathname}${location.search}`,
      },
    });
  }

  function setActiveWindowContentMode(contentMode: ShellWindowContentMode) {
    if (activeWindow === null || activeWindow.contentMode === null) {
      return;
    }

    dispatch({
      type: "set_content_mode",
      windowId: activeWindow.windowId,
      contentMode,
    });
  }

  function openDirectCallThread(withJoinIntent: boolean) {
    if (visibleDirectCallSurface === null) {
      return;
    }

    const nextParams = new URLSearchParams();
    nextParams.set("chat", visibleDirectCallSurface.chat.id);
    if (withJoinIntent) {
      nextParams.set("call", canReturnToCall ? "return" : "join");
    }

    openDirectChat({
      chatId: visibleDirectCallSurface.chat.id,
      title: visibleDirectCallPeer?.nickname ?? "Личный чат",
      searchParams: nextParams,
    });
  }

  function handleTaskbarClick(window: ShellWindow) {
    if (runtimeState.activeWindowId === window.windowId && window.state !== "minimized") {
      dispatch({
        type: "minimize",
        windowId: window.windowId,
      });
      return;
    }

    dispatch({
      type: window.state === "minimized" ? "restore" : "focus",
      windowId: window.windowId,
    });

    if (window.routePath) {
      navigate(window.routePath);
    }
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
    <DesktopShellHostContext.Provider
      value={{
        isDesktopShell: true,
        activeWindowId: activeWindow?.windowId ?? null,
        activeWindowContentMode: activeWindow?.contentMode ?? null,
        launchApp,
        openDirectChat,
        openGroupChat,
        openPersonProfile,
        setActiveWindowContentMode,
        syncCurrentRouteTitle,
      }}
    >
      <div className={styles.shell}>
        <div className={styles.wallpaper} aria-hidden="true" />
        <div className={styles.wallpaperGlow} aria-hidden="true" />

        <section className={styles.desktopSurface}>
          <header className={styles.desktopHeader}>
            <div>
              <p className={styles.brandEyebrow}>AeroChat</p>
              <h1 className={styles.desktopTitle}>Desktop shell runtime</h1>
              <p className={styles.desktopSubtitle}>
                @{state.profile.login} · {state.profile.nickname}
              </p>
            </div>
            <div className={styles.headerBadges}>
              <span className={styles.headerBadge}>XP-first</span>
              <span className={styles.headerBadge}>wide-screen shell</span>
              <span className={styles.headerBadge}>window registry</span>
            </div>
          </header>

          {visibleDirectCallSurface && (
            <section className={styles.callNotice}>
              <div>
                <p className={styles.callLabel}>Активный direct call</p>
                <h2 className={styles.callTitle}>
                  {visibleDirectCallPeer?.nickname ?? "Direct chat"}
                </h2>
                <p className={styles.callText}>
                  {canReturnToCall
                    ? "Звонок ещё активен. Можно вернуться в thread без потери shell context."
                    : "В одном из direct chats уже есть активный звонок. Можно открыть thread или присоединиться."}
                </p>
              </div>
              <div className={styles.callActions}>
                <button
                  className={styles.shellGhostButton}
                  onClick={() => {
                    openDirectCallThread(false);
                  }}
                  type="button"
                >
                  Открыть чат
                </button>
                <button
                  className={styles.shellPrimaryButton}
                  onClick={() => {
                    openDirectCallThread(true);
                  }}
                  type="button"
                >
                  {canReturnToCall ? "Вернуться в звонок" : "Присоединиться"}
                </button>
                <button
                  className={styles.shellGhostButton}
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

          {runtimeState.notice && (
            <section className={styles.noticeBar} role="status">
              <span>{runtimeState.notice.message}</span>
              <button
                className={styles.noticeDismiss}
                onClick={() => {
                  dispatch({ type: "dismiss_notice" });
                }}
                type="button"
              >
                Закрыть
              </button>
            </section>
          )}

          <section className={styles.desktopGrid} aria-label="Desktop entrypoints">
            {desktopEntryItems.map((item) => (
              <button
                key={item.appId}
                className={styles.desktopIcon}
                onClick={() => {
                  launchApp(item.appId);
                }}
                type="button"
              >
                <span className={styles.desktopIconBadge}>{item.label.slice(0, 1)}</span>
                <span className={styles.desktopIconLabel}>{item.label}</span>
                <small className={styles.desktopIconMeta}>{item.meta}</small>
              </button>
            ))}
          </section>

          <section className={styles.windowLayer} aria-label="Shell windows">
            {runtimeState.windows.map((window, index) => (
              <div
                key={window.windowId}
                className={
                  window.state === "minimized"
                    ? styles.windowHidden
                    : window.state === "maximized"
                      ? styles.windowMaximized
                      : styles.windowFrame
                }
                style={
                  window.state === "maximized"
                    ? undefined
                    : {
                        top: `${5 + index * 3}%`,
                        left: `${6 + index * 4}%`,
                      }
                }
              >
                <div className={styles.windowChrome}>
                  <button
                    className={styles.windowTitleButton}
                    onClick={() => {
                      dispatch({ type: "focus", windowId: window.windowId });
                      if (window.routePath) {
                        navigate(window.routePath);
                      }
                    }}
                    type="button"
                  >
                    {window.title}
                  </button>
                  <div className={styles.windowControls}>
                    <button
                      className={styles.windowControl}
                      onClick={() => {
                        dispatch({ type: "minimize", windowId: window.windowId });
                      }}
                      type="button"
                    >
                      _
                    </button>
                    <button
                      className={styles.windowControl}
                      onClick={() => {
                        dispatch({
                          type:
                            window.state === "maximized" ? "restore" : "maximize",
                          windowId: window.windowId,
                        });
                      }}
                      type="button"
                    >
                      □
                    </button>
                    <button
                      className={styles.windowControlDanger}
                      onClick={() => {
                        dispatch({ type: "close", windowId: window.windowId });
                      }}
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className={styles.windowBody}>
                  <ShellWindowBody
                    activeWindowId={runtimeState.activeWindowId}
                    onLaunchApp={launchApp}
                    window={window}
                  />
                </div>
              </div>
            ))}
          </section>
        </section>

        <footer className={styles.taskbar}>
          <div className={styles.taskbarLeft}>
            <button
              className={styles.startButton}
              onClick={() => {
                setIsStartOpen((current) => !current);
              }}
              type="button"
            >
              Start
            </button>

            {isStartOpen && (
              <section className={styles.startMenu}>
                <div className={styles.startMenuHeader}>
                  <strong>{state.profile.nickname}</strong>
                  <span>@{state.profile.login}</span>
                </div>

                <div className={styles.startMenuList}>
                  {startMenuItems.map((item) => (
                    <button
                      key={item.appId}
                      className={styles.startMenuItem}
                      onClick={() => {
                        launchApp(item.appId);
                      }}
                      type="button"
                    >
                      <span>{shellAppRegistry[item.appId].title}</span>
                      <small>{item.description}</small>
                    </button>
                  ))}
                </div>

                <div className={styles.startMenuFooter}>
                  <button
                    className={styles.startMenuAction}
                    onClick={onRequestRebootToBoot}
                    type="button"
                  >
                    Перезапуск в boot
                  </button>
                  <button
                    className={styles.startMenuAction}
                    disabled={isLoggingOut}
                    onClick={() => {
                      void handleLogout();
                    }}
                    type="button"
                  >
                    {isLoggingOut ? "Выход..." : "Выйти"}
                  </button>
                </div>
                {logoutError && <p className={styles.startMenuError}>{logoutError}</p>}
              </section>
            )}

            <div className={styles.taskbarWindows}>
              {listTaskbarShellWindows(runtimeState).map((window) => (
                <button
                  key={window.windowId}
                  className={
                    runtimeState.activeWindowId === window.windowId
                      ? styles.taskbarWindowActive
                      : styles.taskbarWindow
                  }
                  onClick={() => {
                    handleTaskbarClick(window);
                  }}
                  type="button"
                >
                  {window.title}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.tray}>
            <span className={styles.trayBadge} aria-label="UI sounds placeholder">
              UI
            </span>
            <span className={styles.trayBadge} aria-label="Network placeholder">
              NET
            </span>
            <div className={styles.clock}>
              <strong>{formatClock(clock)}</strong>
              <small>{formatDate(clock)}</small>
            </div>
          </div>
        </footer>
      </div>
    </DesktopShellHostContext.Provider>
  );
}

function ShellWindowBody({
  activeWindowId,
  onLaunchApp,
  window,
}: {
  activeWindowId: string | null;
  onLaunchApp(appId: ShellAppId): void;
  window: ShellWindow;
}) {
  const { appId } = window;

  if (appId === "self_chat") {
    return (
      <div className={styles.placeholderCard}>
        <p className={styles.placeholderLabel}>Self Chat / Я</p>
        <h2 className={styles.placeholderTitle}>Канонический self-chat ещё не выделен в отдельный runtime target.</h2>
        <p className={styles.placeholderText}>
          В этом slice окно `Я` служит системным placeholder-entrypoint. Следующий chat-target PR
          должен дать отдельный self/direct target без привязки к старому sidebar shell.
        </p>
        <button
          className={styles.shellPrimaryButton}
          onClick={() => {
            onLaunchApp("chats");
          }}
          type="button"
        >
          Открыть текущий chat workspace
        </button>
      </div>
    );
  }

  if (appId === "friend_requests") {
    return (
      <div className={styles.placeholderCard}>
        <p className={styles.placeholderLabel}>Friend Requests</p>
        <h2 className={styles.placeholderTitle}>Выделенное системное приложение заявок ещё не вынесено из раздела людей.</h2>
        <p className={styles.placeholderText}>
          В текущем runtime заявки остаются продуктово доступными через существующий People screen,
          а shell уже резервирует отдельный системный entrypoint под следующий slice.
        </p>
        <button
          className={styles.shellPrimaryButton}
          onClick={() => {
            onLaunchApp("people");
          }}
          type="button"
        >
          Открыть Люди
        </button>
      </div>
    );
  }

  if (!isRouteBackedShellAppId(appId)) {
    return null;
  }

  if (window.windowId !== activeWindowId) {
    return (
      <div className={styles.placeholderCard}>
        <p className={styles.placeholderLabel}>Route-backed window</p>
        <h2 className={styles.placeholderTitle}>{window.title}</h2>
        <p className={styles.placeholderText}>
          Для desktop shell route остаётся source of truth только для foreground target. При
          фокусе это окно восстановит свой chat/group screen без дублирования window instance.
        </p>
      </div>
    );
  }

  return (
    <div
      className={styles.routeHost}
      data-active-route-app={appId}
      data-window-content-mode={
        window.contentMode ?? getDefaultShellWindowContentMode(window.appId) ?? undefined
      }
    >
      {renderShellAppContent(appId)}
    </div>
  );
}

function formatClock(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}
