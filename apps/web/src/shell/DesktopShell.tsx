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
import { gatewayClient } from "../gateway/runtime";
import { parseDirectChatRealtimeEvent } from "../chats/realtime";
import { parseGroupRealtimeEvent } from "../groups/realtime";
import { subscribeRealtimeEnvelopes } from "../realtime/events";
import { selectVisibleDirectCallSurfaceEntry } from "../rtc/awareness";
import { useDirectCallAwareness } from "../rtc/useDirectCallAwareness";
import { DesktopShellHostContext } from "./context";
import {
  describeDirectChatDesktopTitle,
  hideDesktopEntity,
  isDesktopEntityHideable,
  listDesktopEntitiesForSurface,
  listDesktopOverflowSummaries,
  readDesktopRegistryState,
  removeGroupChatDesktopEntity,
  syncDirectChatDesktopEntities,
  syncGroupChatDesktopEntities,
  upsertDirectChatDesktopEntity,
  upsertGroupChatDesktopEntity,
  writeDesktopRegistryState,
  type DesktopEntity,
} from "./desktop-registry";
import { getBrowserShellPreferencesStorage } from "./preferences";
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

const startMenuItems: Array<{
  appId: ShellAppId;
  description: string;
}> = [
  { appId: "search", description: "Поиск сообщений и быстрый переход в текущие conversations." },
  {
    appId: "explorer",
    description: "Системный organizer entrypoint для будущих Explorer и folder surfaces.",
  },
  { appId: "settings", description: "Privacy, devices, sessions и account preferences." },
  {
    appId: "self_chat",
    description: "Канонический self-facing singleton target для текущего пользователя.",
  },
  {
    appId: "friend_requests",
    description: "Каноническое окно входящих и исходящих friend requests.",
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
  const [storage] = useState(() => getBrowserShellPreferencesStorage());
  const [desktopRegistryState, setDesktopRegistryState] = useState(() =>
    readDesktopRegistryState(storage),
  );
  const [selectedDesktopEntryId, setSelectedDesktopEntryId] = useState<string | null>(null);
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

    const routeTarget = routeEntry.target;

    if (routeEntry.app.appId === "direct_chat" && routeTarget !== null) {
      setDesktopRegistryState((currentState) =>
        upsertDirectChatDesktopEntity(
          currentState,
          routeTarget.key,
          routeTarget.title ?? "Личный чат",
        ),
      );
    }

    if (routeEntry.app.appId === "group_chat" && routeTarget !== null) {
      setDesktopRegistryState((currentState) =>
        upsertGroupChatDesktopEntity(
          currentState,
          routeTarget.key,
          routeTarget.title ?? "Группа",
        ),
      );
    }

    dispatch({
      type: "launch",
      app: routeEntry.app,
      target: routeEntry.target,
    });
  }, [routeEntry]);

  useEffect(() => {
    writeDesktopRegistryState(storage, desktopRegistryState);
  }, [desktopRegistryState, storage]);

  const activeWindow = selectActiveShellWindow(runtimeState);

  useEffect(() => {
    const desiredPath = activeWindow?.routePath ?? "/app";
    const currentPath = `${location.pathname}${location.search}`;
    if (desiredPath === currentPath) {
      return;
    }

    navigate(desiredPath, { replace: true });
  }, [activeWindow?.routePath, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (state.status !== "authenticated") {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const [directChats, groups] = await Promise.all([
          gatewayClient.listDirectChats(state.token),
          gatewayClient.listGroups(state.token),
        ]);
        if (cancelled) {
          return;
        }

        setDesktopRegistryState((currentState) =>
          syncGroupChatDesktopEntities(
            syncDirectChatDesktopEntities(currentState, directChats, state.profile.id),
            groups,
          ),
        );
      } catch {
        // Desktop registry остаётся локальным UX-слоем и не должен ломать shell при деградации list bootstrap.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state]);

  useEffect(() => {
    if (state.status !== "authenticated") {
      return;
    }

    return subscribeRealtimeEnvelopes((envelope) => {
      const directEvent = parseDirectChatRealtimeEvent(envelope);
      if (directEvent?.type === "direct_chat.message.updated") {
        setDesktopRegistryState((currentState) =>
          upsertDirectChatDesktopEntity(
            currentState,
            directEvent.chat.id,
            describeDirectChatDesktopTitle(directEvent.chat, state.profile.id),
          ),
        );
        return;
      }

      const groupEvent = parseGroupRealtimeEvent(envelope);
      if (groupEvent === null) {
        return;
      }

      if (groupEvent.type === "group.message.updated") {
        setDesktopRegistryState((currentState) =>
          upsertGroupChatDesktopEntity(
            currentState,
            groupEvent.group.id,
            groupEvent.group.name,
          ),
        );
        return;
      }

      if (groupEvent.type === "group.membership.updated") {
        if (groupEvent.group === null || groupEvent.selfMember === null) {
          setDesktopRegistryState((currentState) =>
            removeGroupChatDesktopEntity(currentState, groupEvent.groupId),
          );
          return;
        }

        const nextGroup = groupEvent.group;
        setDesktopRegistryState((currentState) =>
          upsertGroupChatDesktopEntity(
            currentState,
            nextGroup.id,
            nextGroup.name,
          ),
        );
        return;
      }

      if ("group" in groupEvent && groupEvent.group !== null) {
        const nextGroup = groupEvent.group;
        setDesktopRegistryState((currentState) =>
          upsertGroupChatDesktopEntity(
            currentState,
            nextGroup.id,
            nextGroup.name,
          ),
        );
      }
    });
  }, [state]);

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
  const desktopEntries = listDesktopEntitiesForSurface(desktopRegistryState);
  const overflowSummaries = listDesktopOverflowSummaries(desktopRegistryState);

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
    setDesktopRegistryState((currentState) =>
      upsertDirectChatDesktopEntity(
        currentState,
        options.chatId,
        target.title ?? options.title ?? "Личный чат",
      ),
    );
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
    setDesktopRegistryState((currentState) =>
      upsertGroupChatDesktopEntity(
        currentState,
        options.groupId,
        target.title ?? options.title ?? "Группа",
      ),
    );
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
    if (routeEntry === null || routeEntry.target === null) {
      return;
    }

    const routeTarget = routeEntry.target;
    const normalizedTitle = title.trim();
    if (normalizedTitle === "") {
      return;
    }

    const launchKey = buildShellLaunchKey(routeEntry.app, routeTarget);
    const currentWindow =
      runtimeState.windows.find((window) => window.launchKey === launchKey) ?? null;
    if (currentWindow?.title === normalizedTitle) {
      return;
    }

    dispatch({
      type: "sync_target",
      app: routeEntry.app,
      target: {
        ...routeTarget,
        title: normalizedTitle,
        routePath: `${location.pathname}${location.search}`,
      },
    });

    if (routeEntry.app.appId === "direct_chat") {
      setDesktopRegistryState((currentState) =>
        upsertDirectChatDesktopEntity(currentState, routeTarget.key, normalizedTitle),
      );
    }

    if (routeEntry.app.appId === "group_chat") {
      setDesktopRegistryState((currentState) =>
        upsertGroupChatDesktopEntity(currentState, routeTarget.key, normalizedTitle),
      );
    }
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

  function openDesktopEntity(entry: DesktopEntity) {
    setSelectedDesktopEntryId(entry.id);

    if (entry.kind === "system_app") {
      launchApp(entry.appId);
      return;
    }

    if (entry.kind === "direct_chat") {
      openDirectChat({
        chatId: entry.targetKey,
        title: entry.title,
      });
      return;
    }

    openGroupChat({
      groupId: entry.targetKey,
      title: entry.title,
    });
  }

  function handleHideDesktopEntity(entry: DesktopEntity) {
    if (!isDesktopEntityHideable(entry)) {
      return;
    }

    setDesktopRegistryState((currentState) => hideDesktopEntity(currentState, entry.id));
    setSelectedDesktopEntryId((currentEntryId) =>
      currentEntryId === entry.id ? null : currentEntryId,
    );
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
              <h1 className={styles.desktopTitle}>Рабочий стол AeroChat</h1>
              <p className={styles.desktopSubtitle}>
                @{state.profile.login} · {state.profile.nickname}
              </p>
            </div>
            <div className={styles.headerBadges}>
              <span className={styles.headerBadge}>XP-first</span>
              <span className={styles.headerBadge}>Primary desktop surface</span>
              <span className={styles.headerBadge}>Entry registry: {desktopEntries.length}</span>
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
            {desktopEntries.map((entry) => (
              <article
                key={entry.id}
                className={
                  selectedDesktopEntryId === entry.id
                    ? styles.desktopIconCardSelected
                    : styles.desktopIconCard
                }
              >
                <button
                  aria-pressed={selectedDesktopEntryId === entry.id}
                  className={styles.desktopIcon}
                  onClick={() => {
                    setSelectedDesktopEntryId(entry.id);
                  }}
                  onDoubleClick={() => {
                    openDesktopEntity(entry);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") {
                      return;
                    }

                    event.preventDefault();
                    openDesktopEntity(entry);
                  }}
                  type="button"
                >
                  <span className={styles.desktopIconBadge}>
                    {describeDesktopEntityBadge(entry)}
                  </span>
                  <span className={styles.desktopIconLabel}>{entry.title}</span>
                  <small className={styles.desktopIconMeta}>
                    {describeDesktopEntityMeta(entry)}
                  </small>
                </button>

                {selectedDesktopEntryId === entry.id && (
                  <div className={styles.desktopIconActions}>
                    <button
                      className={styles.desktopIconAction}
                      onClick={() => {
                        openDesktopEntity(entry);
                      }}
                      type="button"
                    >
                      Открыть
                    </button>
                    {isDesktopEntityHideable(entry) && (
                      <button
                        className={styles.desktopIconActionGhost}
                        onClick={() => {
                          handleHideDesktopEntity(entry);
                        }}
                        type="button"
                      >
                        Убрать с рабочего стола
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </section>

          {overflowSummaries.length > 0 && (
            <section className={styles.overflowPanel} aria-label="Desktop overflow">
              <div>
                <p className={styles.placeholderLabel}>Desktop overflow</p>
                <h2 className={styles.placeholderTitle}>
                  Часть entrypoints вынесена в shell-local buckets
                </h2>
                <p className={styles.placeholderText}>
                  Этот slice держит переполнение bounded без кастомных folders и без fake Explorer UX.
                </p>
              </div>
              <div className={styles.overflowSummaryList}>
                {overflowSummaries.map((entry) => (
                  <article key={entry.bucket} className={styles.overflowSummaryCard}>
                    <strong>{entry.title}</strong>
                    <span>{entry.count}</span>
                  </article>
                ))}
              </div>
            </section>
          )}

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
  window,
}: {
  activeWindowId: string | null;
  window: ShellWindow;
}) {
  const { appId } = window;

  if (!isRouteBackedShellAppId(appId)) {
    return <div className={styles.routeHost}>{renderShellAppContent(appId)}</div>;
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

function describeDesktopEntityBadge(entry: DesktopEntity): string {
  if (entry.kind === "direct_chat" || entry.kind === "group_chat") {
    return entry.title.slice(0, 1).toUpperCase();
  }

  if (entry.appId === "friend_requests") {
    return "З";
  }

  if (entry.appId === "self_chat") {
    return "Я";
  }

  return entry.title.slice(0, 1).toUpperCase();
}

function describeDesktopEntityMeta(entry: DesktopEntity): string {
  if (entry.kind === "direct_chat") {
    return "Личный чат";
  }

  if (entry.kind === "group_chat") {
    return "Группа";
  }

  if (entry.appId === "search") {
    return "Поиск";
  }

  if (entry.appId === "explorer") {
    return "Organizer";
  }

  if (entry.appId === "friend_requests") {
    return "Заявки";
  }

  if (entry.appId === "settings") {
    return "Настройки";
  }

  return "Системное";
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
