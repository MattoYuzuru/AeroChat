import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getAuthErrorMessage, useAuth } from "../auth/useAuth";
import {
  buildDirectChatShellTarget,
  buildExplorerRoutePath,
  buildExplorerFolderRoutePath,
  buildGroupChatShellTarget,
  buildPersonProfileShellTarget,
  isRouteBackedShellAppId,
  renderShellAppContent,
  resolveShellRouteEntry,
  shellAppRegistry,
} from "../app/app-routes";
import { gatewayClient } from "../gateway/runtime";
import { parseDirectChatRealtimeEvent } from "../chats/realtime";
import type { DirectChat, Group } from "../gateway/types";
import { parseGroupRealtimeEvent } from "../groups/realtime";
import { subscribeRealtimeEnvelopes } from "../realtime/events";
import { selectVisibleDirectCallSurfaceEntry } from "../rtc/awareness";
import { useDirectCallAwareness } from "../rtc/useDirectCallAwareness";
import { DesktopShellHostContext } from "./context";
import {
  addCustomFolderMemberReference,
  createCustomFolderDesktopEntity,
  createDesktopUnreadTargetMap,
  deleteCustomFolderDesktopEntity,
  describeDirectChatDesktopTitle,
  getCustomFolderDesktopEntity,
  getCustomFolderUnreadCount,
  hideDesktopEntity,
  isDesktopEntityHideable,
  listCustomFolderDesktopEntities,
  listCustomFolderMemberReferences,
  listDesktopEntitiesForSurface,
  listDesktopOverflowSummaries,
  removeCustomFolderMemberReference,
  readDesktopRegistryState,
  renameCustomFolderDesktopEntity,
  removeGroupChatDesktopEntity,
  showDesktopEntityOnDesktop,
  syncDirectChatDesktopEntities,
  syncGroupChatDesktopEntities,
  upsertDirectChatDesktopEntity,
  upsertGroupChatDesktopEntity,
  writeDesktopRegistryState,
  type DesktopFolderReferenceTarget,
  type DesktopEntity,
} from "./desktop-registry";
import {
  createDesktopBackgroundFolderCreationResult,
  createClosedDesktopContextMenuState,
  listDesktopBackgroundContextMenuItems,
  listDesktopContextMenuItems,
  reduceDesktopContextMenuState,
  type DesktopBackgroundContextMenuCommandId,
  type DesktopEntryContextMenuCommandId,
} from "./desktop-context-menu";
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
import {
  createInitialStartMenuPanelState,
  describeStartMenuRecentItemBadge,
  describeStartMenuRecentItemMeta,
  extractSearchParamsFromRoutePath,
  MAX_START_MENU_FOLDER_ITEMS,
  readStartMenuRecentItems,
  startMenuLauncherApps,
  startMenuPanelReducer,
  trackStartMenuRecentWindow,
  writeStartMenuRecentItems,
  type StartMenuRecentItem,
} from "./start-menu";
import {
  createStoredShellWindowPlacementRecord,
  normalizeShellWindowBounds,
  planShellWindowPlacementForLaunch,
  readShellWindowPlacementStorageState,
  upsertShellWindowPlacementRecord,
  writeShellWindowPlacementStorageState,
  type ShellWindowPlacementStorageState,
  type ShellWindowViewport,
} from "./window-placement";
import styles from "./DesktopShell.module.css";

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
  const [startMenuState, dispatchStartMenu] = useReducer(
    startMenuPanelReducer,
    undefined,
    createInitialStartMenuPanelState,
  );
  const [storage] = useState(() => getBrowserShellPreferencesStorage());
  const [desktopRegistryState, setDesktopRegistryState] = useState(() =>
    readDesktopRegistryState(storage),
  );
  const [desktopContextMenuState, dispatchDesktopContextMenu] = useReducer(
    reduceDesktopContextMenuState,
    undefined,
    createClosedDesktopContextMenuState,
  );
  const [recentItems, setRecentItems] = useState<StartMenuRecentItem[]>(() =>
    readStartMenuRecentItems(storage),
  );
  const [windowPlacementStorageState, setWindowPlacementStorageState] =
    useState<ShellWindowPlacementStorageState>(() =>
      readShellWindowPlacementStorageState(storage),
    );
  const [liveDirectChats, setLiveDirectChats] = useState<DirectChat[]>([]);
  const [liveGroups, setLiveGroups] = useState<Group[]>([]);
  const [selectedDesktopEntryId, setSelectedDesktopEntryId] = useState<string | null>(null);
  const [folderRenameDialogState, setFolderRenameDialogState] = useState<{
    folderId: string;
    name: string;
  } | null>(null);
  const [folderDeleteDialogState, setFolderDeleteDialogState] = useState<{
    folderId: string;
    title: string;
  } | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const startMenuAnchorRef = useRef<HTMLDivElement | null>(null);
  const desktopContextMenuRef = useRef<HTMLDivElement | null>(null);
  const windowLayerRef = useRef<HTMLElement | null>(null);
  const previousRuntimeWindowsRef = useRef(runtimeState.windows);
  const windowPlacementStorageStateRef = useRef(windowPlacementStorageState);
  const launchShellAppWindowRef = useRef<
    ((
      app: (typeof shellAppRegistry)[ShellAppId],
      target: Parameters<typeof buildShellLaunchKey>[1],
    ) => void) | null
  >(null);
  const [windowLayerViewport, setWindowLayerViewport] = useState<ShellWindowViewport>(() =>
    readInitialShellWindowViewport(),
  );

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
    function updateViewport() {
      setWindowLayerViewport(readShellWindowViewport(windowLayerRef.current));
    }

    updateViewport();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updateViewport();
          });

    if (windowLayerRef.current !== null) {
      resizeObserver?.observe(windowLayerRef.current);
    }

    window.addEventListener("resize", updateViewport);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

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

    launchShellAppWindowRef.current?.(routeEntry.app, routeEntry.target);
  }, [routeEntry]);

  useEffect(() => {
    writeDesktopRegistryState(storage, desktopRegistryState);
  }, [desktopRegistryState, storage]);

  useEffect(() => {
    writeStartMenuRecentItems(storage, recentItems);
  }, [recentItems, storage]);

  useEffect(() => {
    windowPlacementStorageStateRef.current = windowPlacementStorageState;
    writeShellWindowPlacementStorageState(storage, windowPlacementStorageState);
  }, [storage, windowPlacementStorageState]);

  useEffect(() => {
    const previousWindows = previousRuntimeWindowsRef.current;
    let nextPlacementState = windowPlacementStorageStateRef.current;
    let changed = false;

    for (const window of runtimeState.windows) {
      const nextRecord = createStoredShellWindowPlacementRecord(
        {
          bounds: normalizeShellWindowBounds(window.bounds, windowLayerViewport),
          state: window.state,
        },
        windowLayerViewport,
      );
      const currentRecord = nextPlacementState.placements[window.launchKey];
      if (areStoredWindowPlacementRecordsEqual(currentRecord, nextRecord)) {
        continue;
      }

      nextPlacementState = upsertShellWindowPlacementRecord(
        nextPlacementState,
        window.launchKey,
        nextRecord,
      );
      changed = true;
    }

    for (const window of previousWindows) {
      if (runtimeState.windows.some((entry) => entry.windowId === window.windowId)) {
        continue;
      }

      const nextRecord = createStoredShellWindowPlacementRecord(
        {
          bounds: normalizeShellWindowBounds(window.bounds, windowLayerViewport),
          state: window.state,
        },
        windowLayerViewport,
      );
      const currentRecord = nextPlacementState.placements[window.launchKey];
      if (areStoredWindowPlacementRecordsEqual(currentRecord, nextRecord)) {
        continue;
      }

      nextPlacementState = upsertShellWindowPlacementRecord(
        nextPlacementState,
        window.launchKey,
        nextRecord,
      );
      changed = true;
    }

    previousRuntimeWindowsRef.current = runtimeState.windows;

    if (!changed) {
      return;
    }

    windowPlacementStorageStateRef.current = nextPlacementState;
    setWindowPlacementStorageState(nextPlacementState);
  }, [runtimeState.windows, windowLayerViewport]);

  const activeWindow = selectActiveShellWindow(runtimeState);
  const desktopUnreadTargetMap = useMemo(
    () => createDesktopUnreadTargetMap(liveDirectChats, liveGroups),
    [liveDirectChats, liveGroups],
  );
  const allCustomFolders = useMemo(
    () => listCustomFolderDesktopEntities(desktopRegistryState),
    [desktopRegistryState],
  );
  const startFolders = useMemo(
    () => allCustomFolders.slice(0, MAX_START_MENU_FOLDER_ITEMS),
    [allCustomFolders],
  );
  const desktopContextMenuEntry = useMemo(
    () =>
      desktopContextMenuState.kind !== "entry"
        ? null
        : (desktopRegistryState.entries.find(
            (entry) => entry.id === desktopContextMenuState.entryId,
          ) ?? null),
    [desktopContextMenuState, desktopRegistryState.entries],
  );
  const desktopContextMenuItems = useMemo(
    () =>
      desktopContextMenuEntry === null
        ? []
        : listDesktopContextMenuItems(desktopContextMenuEntry, desktopRegistryState),
    [desktopContextMenuEntry, desktopRegistryState],
  );
  const desktopBackgroundContextMenuItems = useMemo(
    () => listDesktopBackgroundContextMenuItems(),
    [],
  );

  useEffect(() => {
    const desiredPath = activeWindow?.routePath ?? "/app";
    const currentPath = `${location.pathname}${location.search}`;
    if (desiredPath === currentPath) {
      return;
    }

    navigate(desiredPath, { replace: true });
  }, [activeWindow?.routePath, location.pathname, location.search, navigate]);

  useEffect(() => {
    dispatchDesktopContextMenu({ type: "close" });
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (activeWindow === null) {
      return;
    }

    setRecentItems((currentItems) => trackStartMenuRecentWindow(currentItems, activeWindow));
  }, [activeWindow]);

  useEffect(() => {
    if (!startMenuState.isOpen) {
      return;
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (startMenuAnchorRef.current?.contains(target)) {
        return;
      }

      dispatchStartMenu({ type: "close" });
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      dispatchStartMenu({ type: "close" });
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [startMenuState.isOpen]);

  useEffect(() => {
    if (desktopContextMenuState.kind === "closed") {
      return;
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (desktopContextMenuRef.current?.contains(target)) {
        return;
      }

      dispatchDesktopContextMenu({ type: "close" });
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      dispatchDesktopContextMenu({ type: "close" });
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [desktopContextMenuState.kind]);

  useEffect(() => {
    if (folderRenameDialogState === null && folderDeleteDialogState === null) {
      return;
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      setFolderRenameDialogState(null);
      setFolderDeleteDialogState(null);
    }

    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [folderDeleteDialogState, folderRenameDialogState]);

  useEffect(() => {
    if (desktopContextMenuState.kind !== "entry" || desktopContextMenuEntry !== null) {
      return;
    }

    dispatchDesktopContextMenu({ type: "close" });
  }, [desktopContextMenuEntry, desktopContextMenuState.kind]);

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

        setLiveDirectChats(directChats);
        setLiveGroups(groups);
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
        setLiveDirectChats((currentChats) => upsertLiveDirectChat(currentChats, directEvent.chat));
        setDesktopRegistryState((currentState) =>
          upsertDirectChatDesktopEntity(
            currentState,
            directEvent.chat.id,
            describeDirectChatDesktopTitle(directEvent.chat, state.profile.id),
          ),
        );
        return;
      }

      if (directEvent?.type === "direct_chat.read.updated") {
        setLiveDirectChats((currentChats) =>
          patchLiveDirectChatUnread(
            currentChats,
            directEvent.chatId,
            directEvent.unreadCount,
            directEvent.encryptedUnreadCount,
          ),
        );
        return;
      }

      const groupEvent = parseGroupRealtimeEvent(envelope);
      if (groupEvent === null) {
        return;
      }

      if (groupEvent.type === "group.message.updated") {
        setLiveGroups((currentGroups) => upsertLiveGroup(currentGroups, groupEvent.group));
        setDesktopRegistryState((currentState) =>
          upsertGroupChatDesktopEntity(
            currentState,
            groupEvent.group.id,
            groupEvent.group.name,
          ),
        );
        return;
      }

      if (groupEvent.type === "group.read.updated") {
        setLiveGroups((currentGroups) =>
          patchLiveGroupUnread(
            currentGroups,
            groupEvent.groupId,
            groupEvent.unreadCount,
            groupEvent.encryptedUnreadCount,
          ),
        );
        return;
      }

      if (groupEvent.type === "group.membership.updated") {
        if (groupEvent.group === null || groupEvent.selfMember === null) {
          setLiveGroups((currentGroups) =>
            currentGroups.filter((group) => group.id !== groupEvent.groupId),
          );
          setDesktopRegistryState((currentState) =>
            removeGroupChatDesktopEntity(currentState, groupEvent.groupId),
          );
          return;
        }

        const nextGroup = groupEvent.group;
        setLiveGroups((currentGroups) => upsertLiveGroup(currentGroups, nextGroup));
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
        setLiveGroups((currentGroups) => upsertLiveGroup(currentGroups, nextGroup));
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
  const hiddenFolderCount = Math.max(0, allCustomFolders.length - startFolders.length);

  function closeStartMenu() {
    dispatchStartMenu({ type: "close" });
  }

  function closeDesktopContextMenu() {
    dispatchDesktopContextMenu({ type: "close" });
  }

  function closeFolderDialogs() {
    setFolderRenameDialogState(null);
    setFolderDeleteDialogState(null);
  }

  function openDesktopContextMenu(
    entry: DesktopEntity,
    position: {
      x: number;
      y: number;
    },
  ) {
    setSelectedDesktopEntryId(entry.id);
    dispatchDesktopContextMenu({
      type: "open_entry",
      entryId: entry.id,
      x: position.x,
      y: position.y,
    });
  }

  function openDesktopBackgroundContextMenu(position: {
    x: number;
    y: number;
  }) {
    setSelectedDesktopEntryId(null);
    dispatchDesktopContextMenu({
      type: "open_background",
      x: position.x,
      y: position.y,
    });
  }

  function openDesktopContextMenuFromButton(
    entry: DesktopEntity,
    buttonElement: HTMLButtonElement,
  ) {
    const rect = buttonElement.getBoundingClientRect();
    openDesktopContextMenu(entry, {
      x: clampDesktopContextMenuCoordinate(rect.left + rect.width / 2, window.innerWidth, 252),
      y: clampDesktopContextMenuCoordinate(rect.top + rect.height / 2, window.innerHeight, 320),
    });
  }

  function openDesktopBackgroundContextMenuFromSurface(surfaceElement: HTMLElement) {
    const rect = surfaceElement.getBoundingClientRect();
    openDesktopBackgroundContextMenu({
      x: clampDesktopContextMenuCoordinate(rect.left + 48, window.innerWidth, 252),
      y: clampDesktopContextMenuCoordinate(rect.top + 112, window.innerHeight, 220),
    });
  }

  function handleDesktopSurfaceClick(event: ReactMouseEvent<HTMLElement>) {
    if (!isDesktopBackgroundTriggerTarget(event.target)) {
      return;
    }

    setSelectedDesktopEntryId(null);
    closeDesktopContextMenu();
    event.currentTarget.focus();
  }

  function handleDesktopSurfaceContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (!isDesktopBackgroundTriggerTarget(event.target)) {
      return;
    }

    event.preventDefault();
    event.currentTarget.focus();
    openDesktopBackgroundContextMenu({
      x: clampDesktopContextMenuCoordinate(event.clientX, window.innerWidth, 252),
      y: clampDesktopContextMenuCoordinate(event.clientY, window.innerHeight, 220),
    });
  }

  function handleDesktopSurfaceKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
      return;
    }

    event.preventDefault();
    openDesktopBackgroundContextMenuFromSurface(event.currentTarget);
  }

  function launchShellAppWindow(
    app: (typeof shellAppRegistry)[ShellAppId],
    target: Parameters<typeof buildShellLaunchKey>[1],
  ) {
    const launchKey = buildShellLaunchKey(app, target);
    const liveWindow =
      runtimeState.windows.find((window) => window.launchKey === launchKey) ?? null;

    if (liveWindow !== null) {
      dispatch({
        type: "launch",
        app,
        target,
        placement: createLiveWindowPlacement(windowLayerViewport, liveWindow),
      });
      return;
    }

    const launchPlan = planShellWindowPlacementForLaunch(
      windowPlacementStorageStateRef.current,
      launchKey,
      windowLayerViewport,
    );
    windowPlacementStorageStateRef.current = launchPlan.storageState;
    setWindowPlacementStorageState(launchPlan.storageState);
    dispatch({
      type: "launch",
      app,
      target,
      placement: launchPlan.placement,
    });
  }

  launchShellAppWindowRef.current = launchShellAppWindow;

  function launchApp(
    appId: ShellAppId,
    options?: {
      routePath?: string | null;
      title?: string;
    },
  ) {
    const app = shellAppRegistry[appId];
    const routePath = options?.routePath ?? app.routePath;
    const routeTarget =
      routePath === null
        ? null
        : {
            key: app.appId,
            title: options?.title?.trim() || app.title,
            routePath,
          };

    launchShellAppWindow(app, routeTarget);
    closeStartMenu();
    closeDesktopContextMenu();

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
    launchShellAppWindow(shellAppRegistry.direct_chat, target);
    closeDesktopContextMenu();
    navigate(target.routePath ?? "/app/chats");
    closeStartMenu();
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
    launchShellAppWindow(shellAppRegistry.group_chat, target);
    closeDesktopContextMenu();
    navigate(target.routePath ?? "/app/groups");
    closeStartMenu();
  }

  function openCustomFolder(folderId: string) {
    const folder = getCustomFolderDesktopEntity(desktopRegistryState, folderId);
    const routePath = buildExplorerFolderRoutePath(folderId);

    launchShellAppWindow(shellAppRegistry.explorer, {
      key: "explorer",
      title: folder === null ? "Explorer" : `Explorer · ${folder.title}`,
      routePath,
    });
    closeDesktopContextMenu();
    navigate(routePath);
    closeStartMenu();
  }

  function createCustomFolder(name: string): string {
    const folderId = `folder-${desktopRegistryState.nextFolderSequence}`;
    setDesktopRegistryState((currentState) =>
      createCustomFolderDesktopEntity(currentState, name),
    );
    return folderId;
  }

  function renameCustomFolder(folderId: string, name: string) {
    setDesktopRegistryState((currentState) =>
      renameCustomFolderDesktopEntity(currentState, folderId, name),
    );
  }

  function deleteCustomFolder(folderId: string) {
    setDesktopRegistryState((currentState) =>
      deleteCustomFolderDesktopEntity(currentState, folderId),
    );
    setSelectedDesktopEntryId((currentEntryId) =>
      currentEntryId === `custom_folder:${folderId}` ? null : currentEntryId,
    );

    if (
      location.pathname === "/app/explorer" &&
      new URLSearchParams(location.search).get("folder") === folderId
    ) {
      navigate(
        buildExplorerRoutePath(
          new URLSearchParams([
            ["section", "folders"],
          ]),
        ),
      );
    }
  }

  function addFolderMember(
    folderId: string,
    target: DesktopFolderReferenceTarget,
  ) {
    setDesktopRegistryState((currentState) =>
      addCustomFolderMemberReference(currentState, folderId, target),
    );
  }

  function removeFolderMember(referenceId: string) {
    setDesktopRegistryState((currentState) =>
      removeCustomFolderMemberReference(currentState, referenceId),
    );
  }

  function openPersonProfile(options: {
    userId: string;
    title?: string;
    searchParams?: URLSearchParams | null;
  }) {
    const target = buildPersonProfileShellTarget(options);
    launchShellAppWindow(shellAppRegistry.person_profile, target);
    closeDesktopContextMenu();
    navigate(target.routePath ?? "/app/people");
    closeStartMenu();
  }

  function openExplorerSection(sectionId: string, title: string) {
    launchApp("explorer", {
      routePath: buildExplorerRoutePath(
        new URLSearchParams([
          ["section", sectionId],
        ]),
      ),
      title,
    });
  }

  function openRecentItem(item: StartMenuRecentItem) {
    if (item.kind === "app") {
      launchApp(item.appId, {
        routePath: item.routePath,
        title: item.title,
      });
      return;
    }

    if (item.kind === "direct_chat") {
      openDirectChat({
        chatId: item.targetKey,
        title: item.title,
        searchParams: extractSearchParamsFromRoutePath(item.routePath),
      });
      return;
    }

    openGroupChat({
      groupId: item.targetKey,
      title: item.title,
      searchParams: extractSearchParamsFromRoutePath(item.routePath),
    });
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
    closeDesktopContextMenu();

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

    if (entry.kind === "custom_folder") {
      openCustomFolder(entry.folderId);
      return;
    }

    openGroupChat({
      groupId: entry.targetKey,
      title: entry.title,
    });
  }

  function handleDesktopContextMenuCommand(
    entry: DesktopEntity,
    commandId: DesktopEntryContextMenuCommandId,
  ) {
    closeDesktopContextMenu();

    if (commandId === "open") {
      openDesktopEntity(entry);
      return;
    }

    if (commandId === "hide") {
      handleHideDesktopEntity(entry);
      return;
    }

    if (entry.kind !== "custom_folder") {
      return;
    }

    if (commandId === "rename_folder") {
      setFolderRenameDialogState({
        folderId: entry.folderId,
        name: entry.title,
      });
      return;
    }

    if (commandId === "delete_folder") {
      setFolderDeleteDialogState({
        folderId: entry.folderId,
        title: entry.title,
      });
    }
  }

  function handleDesktopBackgroundContextMenuCommand(
    commandId: DesktopBackgroundContextMenuCommandId,
  ) {
    closeDesktopContextMenu();

    if (commandId === "open_explorer") {
      launchApp("explorer");
      return;
    }

    const createdFolder = createDesktopBackgroundFolderCreationResult(desktopRegistryState);
    setDesktopRegistryState(createdFolder.registryState);
    setSelectedDesktopEntryId(createdFolder.entryId);
    setFolderRenameDialogState({
      folderId: createdFolder.folderId,
      name: createdFolder.name,
    });
  }

  function handleAddDesktopTargetToFolderFromMenu(
    entry: DesktopEntity,
    folderId: string,
  ) {
    if (entry.kind !== "direct_chat" && entry.kind !== "group_chat") {
      return;
    }

    addFolderMember(folderId, {
      kind: entry.kind,
      targetKey: entry.targetKey,
    });
    closeDesktopContextMenu();
  }

  function handleHideDesktopEntity(entry: DesktopEntity) {
    if (!isDesktopEntityHideable(entry)) {
      return;
    }

    closeDesktopContextMenu();
    hideDesktopEntry(entry.id);
    setSelectedDesktopEntryId((currentEntryId) =>
      currentEntryId === entry.id ? null : currentEntryId,
    );
  }

  function hideDesktopEntry(entryId: string) {
    setDesktopRegistryState((currentState) => hideDesktopEntity(currentState, entryId));
  }

  function showDesktopEntry(entryId: string) {
    setDesktopRegistryState((currentState) => showDesktopEntityOnDesktop(currentState, entryId));
  }

  function submitFolderRenameDialog() {
    if (folderRenameDialogState === null) {
      return;
    }

    const normalizedName = folderRenameDialogState.name.trim();
    if (normalizedName === "") {
      return;
    }

    renameCustomFolder(folderRenameDialogState.folderId, normalizedName);
    closeFolderDialogs();
  }

  function confirmFolderDeleteDialog() {
    if (folderDeleteDialogState === null) {
      return;
    }

    deleteCustomFolder(folderDeleteDialogState.folderId);
    closeFolderDialogs();
  }

  async function handleLogout() {
    setIsLoggingOut(true);
    setLogoutError(null);

    try {
      await logout();
      closeStartMenu();
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
        desktopRegistryState,
        desktopUnreadTargetMap,
        launchApp,
        openDirectChat,
        openGroupChat,
        openCustomFolder,
        openPersonProfile,
        createCustomFolder,
        renameCustomFolder,
        deleteCustomFolder,
        addFolderMember,
        removeFolderMember,
        hideDesktopEntry,
        showDesktopEntry,
        setActiveWindowContentMode,
        syncCurrentRouteTitle,
      }}
    >
      <div className={styles.shell}>
        <div className={styles.wallpaper} aria-hidden="true" />
        <div className={styles.wallpaperGlow} aria-hidden="true" />

        <section
          aria-label="Рабочий стол AeroChat"
          className={styles.desktopSurface}
          onClick={handleDesktopSurfaceClick}
          onContextMenu={handleDesktopSurfaceContextMenu}
          onKeyDown={handleDesktopSurfaceKeyDown}
          tabIndex={0}
        >
          <header className={styles.desktopHeader} data-desktop-background-blocker="true">
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
            <section
              className={styles.callNotice}
              data-desktop-background-blocker="true"
            >
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
            <section
              className={styles.noticeBar}
              data-desktop-background-blocker="true"
              role="status"
            >
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
            {desktopEntries.map((entry) => {
              const folderUnreadCount =
                entry.kind === "custom_folder"
                  ? getCustomFolderUnreadCount(
                      desktopRegistryState,
                      entry.folderId,
                      desktopUnreadTargetMap,
                    )
                  : 0;

              return (
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
                    data-desktop-entry="true"
                    onClick={() => {
                      setSelectedDesktopEntryId(entry.id);
                      closeDesktopContextMenu();
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openDesktopContextMenu(entry, {
                        x: clampDesktopContextMenuCoordinate(
                          event.clientX,
                          window.innerWidth,
                          252,
                        ),
                        y: clampDesktopContextMenuCoordinate(
                          event.clientY,
                          window.innerHeight,
                          320,
                        ),
                      });
                    }}
                    onDoubleClick={() => {
                      openDesktopEntity(entry);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openDesktopEntity(entry);
                        return;
                      }

                      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                        event.preventDefault();
                        openDesktopContextMenuFromButton(entry, event.currentTarget);
                      }
                    }}
                    type="button"
                  >
                    <span className={styles.desktopIconBadgeWrap}>
                      <span className={styles.desktopIconBadge}>
                        {describeDesktopEntityBadge(entry)}
                      </span>
                      {folderUnreadCount > 0 && (
                        <span className={styles.desktopUnreadBadge}>
                          {folderUnreadCount}
                        </span>
                      )}
                    </span>
                    <span className={styles.desktopIconLabel}>{entry.title}</span>
                    <small className={styles.desktopIconMeta}>
                      {describeDesktopEntityMeta(entry, desktopRegistryState)}
                    </small>
                  </button>
                </article>
              );
            })}
          </section>

          {desktopContextMenuState.kind === "entry" && desktopContextMenuEntry !== null && (
            <DesktopContextMenuPanel
              ariaLabel={`Контекстное меню ${desktopContextMenuEntry.title}`}
              headerMeta={describeDesktopEntityMeta(desktopContextMenuEntry, desktopRegistryState)}
              headerTitle={desktopContextMenuEntry.title}
              isAddToFolderExpanded={desktopContextMenuState.isAddToFolderExpanded}
              items={desktopContextMenuItems}
              menuRef={desktopContextMenuRef}
              onAddToFolderToggle={() => {
                dispatchDesktopContextMenu({ type: "toggle_add_to_folder" });
              }}
              onClose={closeDesktopContextMenu}
              onCommand={(commandId) => {
                handleDesktopContextMenuCommand(
                  desktopContextMenuEntry,
                  commandId as DesktopEntryContextMenuCommandId,
                );
              }}
              onSelectFolder={(folderId) => {
                handleAddDesktopTargetToFolderFromMenu(desktopContextMenuEntry, folderId);
              }}
              position={{
                x: desktopContextMenuState.x,
                y: desktopContextMenuState.y,
              }}
            />
          )}

          {desktopContextMenuState.kind === "background" && (
            <DesktopContextMenuPanel
              ariaLabel="Контекстное меню рабочего стола"
              headerMeta="Канонические shell-local действия"
              headerTitle="Рабочий стол"
              isAddToFolderExpanded={false}
              items={desktopBackgroundContextMenuItems}
              menuRef={desktopContextMenuRef}
              onClose={closeDesktopContextMenu}
              onCommand={(commandId) => {
                handleDesktopBackgroundContextMenuCommand(
                  commandId as DesktopBackgroundContextMenuCommandId,
                );
              }}
              position={{
                x: desktopContextMenuState.x,
                y: desktopContextMenuState.y,
              }}
            />
          )}

          {overflowSummaries.length > 0 && (
            <section
              aria-label="Desktop overflow"
              className={styles.overflowPanel}
              data-desktop-background-blocker="true"
            >
              <div>
                <p className={styles.placeholderLabel}>Desktop overflow</p>
                <h2 className={styles.placeholderTitle}>
                  Часть entrypoints вынесена в shell-local buckets
                </h2>
                <p className={styles.placeholderText}>
                  Детальная навигация по hidden и overflow entrypoints теперь доступна через Explorer.
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
              <button
                className={styles.shellGhostButton}
                onClick={() => {
                  openExplorerSection("overflow", "Explorer · Overflow");
                }}
                type="button"
              >
                Открыть Explorer
              </button>
            </section>
          )}

          <section
            aria-label="Shell windows"
            className={styles.windowLayer}
            data-desktop-background-blocker="true"
            ref={windowLayerRef}
          >
            {runtimeState.windows.map((window) => {
              const renderedBounds = normalizeShellWindowBounds(
                window.bounds,
                windowLayerViewport,
              );

              return (
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
                          top: `${renderedBounds.y}px`,
                          left: `${renderedBounds.x}px`,
                          width: `${renderedBounds.width}px`,
                          height: `${renderedBounds.height}px`,
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
              );
            })}
          </section>
        </section>

        {folderRenameDialogState !== null && (
          <div
            className={styles.dialogOverlay}
            onMouseDown={(event) => {
              if (event.target !== event.currentTarget) {
                return;
              }

              closeFolderDialogs();
            }}
            role="presentation"
          >
            <form
              aria-label="Переименовать папку"
              className={styles.dialogCard}
              onSubmit={(event) => {
                event.preventDefault();
                submitFolderRenameDialog();
              }}
              role="dialog"
            >
              <p className={styles.placeholderLabel}>Desktop folder</p>
              <h2 className={styles.placeholderTitle}>Переименовать папку</h2>
              <p className={styles.placeholderText}>
                Изменится только shell-local label. Ссылки на chats и groups сохранятся.
              </p>
              <label className={styles.dialogField}>
                <span>Название папки</span>
                <input
                  autoFocus
                  className={styles.dialogInput}
                  onChange={(event) => {
                    setFolderRenameDialogState((currentState) =>
                      currentState === null
                        ? null
                        : {
                            ...currentState,
                            name: event.target.value,
                          },
                    );
                  }}
                  type="text"
                  value={folderRenameDialogState.name}
                />
              </label>
              <div className={styles.actions}>
                <button
                  className={styles.shellGhostButton}
                  onClick={() => {
                    closeFolderDialogs();
                  }}
                  type="button"
                >
                  Отмена
                </button>
                <button className={styles.shellPrimaryButton} type="submit">
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        )}

        {folderDeleteDialogState !== null && (
          <div
            className={styles.dialogOverlay}
            onMouseDown={(event) => {
              if (event.target !== event.currentTarget) {
                return;
              }

              closeFolderDialogs();
            }}
            role="presentation"
          >
            <section
              aria-label="Удалить папку"
              className={styles.dialogCard}
              role="dialog"
            >
              <p className={styles.placeholderLabel}>Desktop folder</p>
              <h2 className={styles.placeholderTitle}>Удалить папку «{folderDeleteDialogState.title}»?</h2>
              <p className={styles.placeholderText}>
                Будет удалён только shell-local folder object и его shortcut-ссылки. Сами chats и
                groups останутся без изменений.
              </p>
              <div className={styles.actions}>
                <button
                  className={styles.shellGhostButton}
                  onClick={() => {
                    closeFolderDialogs();
                  }}
                  type="button"
                >
                  Отмена
                </button>
                <button
                  className={styles.dialogDangerButton}
                  onClick={() => {
                    confirmFolderDeleteDialog();
                  }}
                  type="button"
                >
                  Удалить папку
                </button>
              </div>
            </section>
          </div>
        )}

        <footer className={styles.taskbar}>
          <div className={styles.taskbarLeft}>
            <div className={styles.startMenuAnchor} ref={startMenuAnchorRef}>
              <button
                aria-controls="shell-start-menu"
                aria-expanded={startMenuState.isOpen}
                className={styles.startButton}
                onClick={() => {
                  dispatchStartMenu({ type: "toggle" });
                }}
                type="button"
              >
                Start
              </button>

              {startMenuState.isOpen && (
                <section
                  aria-label="Start launcher"
                  className={styles.startMenu}
                  id="shell-start-menu"
                >
                  <div className={styles.startMenuHeader}>
                    <div>
                      <strong>{state.profile.nickname}</strong>
                      <span>@{state.profile.login}</span>
                    </div>
                    <small>Launcher-first surface</small>
                  </div>

                  <div className={styles.startMenuBody}>
                    <section className={styles.startMenuSection}>
                      <div className={styles.startMenuSectionHeader}>
                        <p className={styles.startMenuSectionEyebrow}>Приложения</p>
                        <span>{startMenuLauncherApps.length}</span>
                      </div>
                      <div className={styles.startMenuList}>
                        {startMenuLauncherApps.map((item) => (
                          <button
                            key={item.appId}
                            className={styles.startMenuItem}
                            onClick={() => {
                              launchApp(item.appId);
                            }}
                            type="button"
                          >
                            <span className={styles.startMenuItemBadge}>{item.badge}</span>
                            <span className={styles.startMenuItemContent}>
                              <span className={styles.startMenuItemTitle}>{item.title}</span>
                              <small>{item.description}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>

                    <section className={styles.startMenuSection}>
                      <div className={styles.startMenuSectionHeader}>
                        <p className={styles.startMenuSectionEyebrow}>Недавние</p>
                        <span>{recentItems.length}</span>
                      </div>
                      {recentItems.length > 0 ? (
                        <div className={styles.startMenuStack}>
                          {recentItems.map((item) => (
                            <button
                              key={item.id}
                              className={styles.startMenuCompactItem}
                              onClick={() => {
                                openRecentItem(item);
                              }}
                              type="button"
                            >
                              <span className={styles.startMenuItemBadge}>
                                {describeStartMenuRecentItemBadge(item)}
                              </span>
                              <span className={styles.startMenuItemContent}>
                                <span className={styles.startMenuItemTitle}>{item.title}</span>
                                <small>{describeStartMenuRecentItemMeta(item)}</small>
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className={styles.startMenuEmptyState}>
                          Здесь появятся recent apps, direct chats и groups после реального запуска или фокуса.
                        </p>
                      )}
                    </section>

                    <section className={styles.startMenuSection}>
                      <div className={styles.startMenuSectionHeader}>
                        <p className={styles.startMenuSectionEyebrow}>Папки</p>
                        <span>{allCustomFolders.length}</span>
                      </div>
                      {startFolders.length > 0 ? (
                        <div className={styles.startMenuStack}>
                          {startFolders.map((folder) => {
                            const unreadCount = getCustomFolderUnreadCount(
                              desktopRegistryState,
                              folder.folderId,
                              desktopUnreadTargetMap,
                            );
                            const memberCount = listCustomFolderMemberReferences(
                              desktopRegistryState,
                              folder.folderId,
                            ).length;

                            return (
                              <button
                                key={folder.id}
                                className={styles.startMenuCompactItem}
                                onClick={() => {
                                  openCustomFolder(folder.folderId);
                                }}
                                type="button"
                              >
                                <span className={styles.startMenuItemBadge}>П</span>
                                <span className={styles.startMenuItemContent}>
                                  <span className={styles.startMenuItemTitle}>{folder.title}</span>
                                  <small>
                                    {memberCount === 0
                                      ? "Папка пуста"
                                      : `Объектов: ${memberCount}${unreadCount > 0 ? ` · unread: ${unreadCount}` : ""}`}
                                  </small>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className={styles.startMenuEmptyState}>
                          Custom folders остаются shell-local organizer objects без отдельного Start management UI.
                        </p>
                      )}
                      {hiddenFolderCount > 0 && (
                        <button
                          className={styles.startMenuSectionLink}
                          onClick={() => {
                            openExplorerSection("folders", "Explorer · Папки");
                          }}
                          type="button"
                        >
                          Показать ещё папки: {hiddenFolderCount}
                        </button>
                      )}
                    </section>

                    <section className={styles.startMenuSection}>
                      <div className={styles.startMenuSectionHeader}>
                        <p className={styles.startMenuSectionEyebrow}>Система</p>
                        <span>3</span>
                      </div>
                      <div className={styles.startMenuActions}>
                        <button
                          className={styles.startMenuAction}
                          onClick={() => {
                            launchApp("settings");
                          }}
                          type="button"
                        >
                          Настройки
                        </button>
                        <button
                          className={styles.startMenuAction}
                          onClick={() => {
                            closeStartMenu();
                            onRequestRebootToBoot();
                          }}
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
                    </section>
                  </div>
                  {logoutError && <p className={styles.startMenuError}>{logoutError}</p>}
                </section>
              )}
            </div>

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

function DesktopContextMenuPanel({
  ariaLabel,
  headerMeta,
  headerTitle,
  isAddToFolderExpanded,
  items,
  menuRef,
  onAddToFolderToggle,
  onClose,
  onCommand,
  onSelectFolder,
  position,
}: {
  ariaLabel: string;
  headerMeta: string;
  headerTitle: string;
  isAddToFolderExpanded: boolean;
  items: Array<
    ReturnType<typeof listDesktopContextMenuItems>[number] | ReturnType<
      typeof listDesktopBackgroundContextMenuItems
    >[number]
  >;
  menuRef: {
    current: HTMLDivElement | null;
  };
  onAddToFolderToggle?(): void;
  onClose(): void;
  onCommand(
    commandId: DesktopEntryContextMenuCommandId | DesktopBackgroundContextMenuCommandId,
  ): void;
  onSelectFolder?(folderId: string): void;
  position: {
    x: number;
    y: number;
  };
}) {
  return (
    <div
      aria-label={ariaLabel}
      className={styles.contextMenu}
      data-desktop-background-blocker="true"
      ref={menuRef}
      role="menu"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      <div className={styles.contextMenuHeader}>
        <strong>{headerTitle}</strong>
        <small>{headerMeta}</small>
      </div>

      <div className={styles.contextMenuList}>
        {items.map((item) => {
          if (item.kind === "command") {
            return (
              <button
                key={item.id}
                className={
                  item.tone === "danger"
                    ? styles.contextMenuButtonDanger
                    : styles.contextMenuButton
                }
                onClick={() => {
                  onCommand(item.id);
                }}
                role="menuitem"
                type="button"
              >
                {item.label}
              </button>
            );
          }

          return (
            <div key={item.id} className={styles.contextMenuFolderGroup}>
              <button
                aria-expanded={isAddToFolderExpanded}
                aria-haspopup="true"
                className={styles.contextMenuButton}
                onClick={() => {
                  onAddToFolderToggle?.();
                }}
                role="menuitem"
                type="button"
              >
                {item.label}
              </button>

              {isAddToFolderExpanded && (
                <div className={styles.contextMenuSubmenu}>
                  {item.folders.length > 0 ? (
                    item.folders.map((folder) => (
                      <button
                        key={folder.folderId}
                        className={styles.contextMenuFolderButton}
                        disabled={folder.isDisabled}
                        onClick={() => {
                          if (folder.isDisabled) {
                            return;
                          }

                          onSelectFolder?.(folder.folderId);
                        }}
                        type="button"
                      >
                        <span>{folder.title}</span>
                        <small>{folder.isDisabled ? "Уже добавлено" : "Добавить"}</small>
                      </button>
                    ))
                  ) : (
                    <p className={styles.contextMenuEmptyState}>
                      Создайте папку в Explorer, чтобы добавить сюда этот target.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        className={styles.contextMenuFooter}
        onClick={() => {
          onClose();
        }}
        type="button"
      >
        Закрыть
      </button>
    </div>
  );
}

function describeDesktopEntityBadge(entry: DesktopEntity): string {
  if (entry.kind === "custom_folder") {
    return "П";
  }

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

function describeDesktopEntityMeta(
  entry: DesktopEntity,
  registryState: {
    entries: DesktopEntity[];
    folderMembers: Array<{ folderId: string }>;
  },
): string {
  if (entry.kind === "direct_chat") {
    return "Личный чат";
  }

  if (entry.kind === "group_chat") {
    return "Группа";
  }

  if (entry.kind === "custom_folder") {
    const memberCount = registryState.folderMembers.filter(
      (reference) => reference.folderId === entry.folderId,
    ).length;
    return memberCount === 0 ? "Папка пуста" : `Папка · ${memberCount} объектов`;
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

function isDesktopBackgroundTriggerTarget(target: EventTarget | null): boolean {
  const element = resolveEventTargetElement(target);
  if (element === null) {
    return false;
  }

  return (
    element.closest(
      "[data-desktop-entry='true'], [data-desktop-background-blocker='true']",
    ) === null
  );
}

function resolveEventTargetElement(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) {
    return target;
  }

  if (target instanceof Node) {
    return target.parentElement;
  }

  return null;
}

function clampDesktopContextMenuCoordinate(
  value: number,
  viewportSize: number,
  menuSize: number,
): number {
  const safeStart = 12;
  return Math.max(safeStart, Math.min(value, viewportSize - menuSize - safeStart));
}

function readInitialShellWindowViewport(): ShellWindowViewport {
  if (typeof window === "undefined") {
    return {
      width: 1120,
      height: 760,
    };
  }

  return {
    width: Math.max(1, Math.round(window.innerWidth - 18 * 16)),
    height: Math.max(1, Math.round(window.innerHeight - 12.1 * 16)),
  };
}

function readShellWindowViewport(
  element: HTMLElement | null,
): ShellWindowViewport {
  if (element === null) {
    return readInitialShellWindowViewport();
  }

  const rect = element.getBoundingClientRect();
  return {
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

function createLiveWindowPlacement(
  viewport: ShellWindowViewport,
  window: Pick<ShellWindow, "bounds" | "state">,
) {
  return {
    bounds: normalizeShellWindowBounds(window.bounds, viewport),
    restoredState: window.state === "maximized" ? "maximized" : "open",
  } as const;
}

function areStoredWindowPlacementRecordsEqual(
  left: ReturnType<typeof createStoredShellWindowPlacementRecord> | undefined,
  right: ReturnType<typeof createStoredShellWindowPlacementRecord>,
): boolean {
  return (
    left?.restoredState === right.restoredState &&
    left?.bounds.x === right.bounds.x &&
    left?.bounds.y === right.bounds.y &&
    left?.bounds.width === right.bounds.width &&
    left?.bounds.height === right.bounds.height
  );
}

function upsertLiveDirectChat(
  chats: DirectChat[],
  nextChat: DirectChat,
): DirectChat[] {
  return upsertLiveTargetById(chats, nextChat);
}

function patchLiveDirectChatUnread(
  chats: DirectChat[],
  chatId: string,
  unreadCount: number | null,
  encryptedUnreadCount: number | null,
): DirectChat[] {
  return chats.map((chat) =>
    chat.id !== chatId
      ? chat
      : {
          ...chat,
          unreadCount: unreadCount ?? chat.unreadCount,
          encryptedUnreadCount: encryptedUnreadCount ?? chat.encryptedUnreadCount,
        },
  );
}

function upsertLiveGroup(groups: Group[], nextGroup: Group): Group[] {
  return upsertLiveTargetById(groups, nextGroup);
}

function patchLiveGroupUnread(
  groups: Group[],
  groupId: string,
  unreadCount: number,
  encryptedUnreadCount: number | null,
): Group[] {
  return groups.map((group) =>
    group.id !== groupId
      ? group
      : {
          ...group,
          unreadCount,
          encryptedUnreadCount:
            encryptedUnreadCount === null
              ? group.encryptedUnreadCount
              : encryptedUnreadCount,
        },
  );
}

function upsertLiveTargetById<T extends { id: string }>(
  items: T[],
  nextItem: T,
): T[] {
  const existingIndex = items.findIndex((item) => item.id === nextItem.id);
  if (existingIndex === -1) {
    return [...items, nextItem];
  }

  return items.map((item) => (item.id === nextItem.id ? nextItem : item));
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
