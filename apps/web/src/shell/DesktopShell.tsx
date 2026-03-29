import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
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
import { parseEncryptedDirectMessageV2RealtimeEvent } from "../chats/encrypted-v2-realtime";
import { patchLiveEncryptedDirectChatActivity } from "../chats/live-direct-activity";
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
  getCustomFolderDesktopEntity,
  getCustomFolderUnreadCount,
  hideDesktopEntity,
  isDesktopEntityHideable,
  listCustomFolderDesktopEntities,
  listCustomFolderMemberReferences,
  listDesktopEntitiesForSurface,
  moveDesktopEntityToIndex,
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
  resolveDesktopGridCellIndex,
  resolveDesktopGridMetrics,
} from "./desktop-grid";
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
  describeStartMenuRecentItemMeta,
  extractSearchParamsFromRoutePath,
  MAX_START_MENU_FOLDER_ITEMS,
  readStartMenuRecentItems,
  resolveStartMenuMaxHeight,
  startMenuLauncherApps,
  startMenuPanelReducer,
  trackStartMenuRecentWindow,
  writeStartMenuRecentItems,
  type StartMenuRecentItem,
} from "./start-menu";
import {
  resolveDesktopEntityIconKey,
  resolveRecentItemIconKey,
  resolveShellAppIconKey,
  ShellIcon,
} from "./shell-icons";
import {
  createStoredShellWindowPlacementRecord,
  normalizeShellWindowBounds,
  planShellWindowPlacementForLaunch,
  readShellWindowPlacementStorageState,
  resizeShellWindowBounds,
  upsertShellWindowPlacementRecord,
  writeShellWindowPlacementStorageState,
  type ShellWindowResizeHandle,
  type ShellWindowPlacementStorageState,
  type ShellWindowViewport,
} from "./window-placement";
import { shouldSyncDesktopRouteToActiveWindow } from "./route-sync";
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
  const [desktopDragEntryId, setDesktopDragEntryId] = useState<string | null>(null);
  const [desktopDropFolderId, setDesktopDropFolderId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{
    windowId: string;
    startX: number;
    startY: number;
    initialBounds: ShellWindow["bounds"];
  } | null>(null);
  const [resizeState, setResizeState] = useState<{
    windowId: string;
    handle: ShellWindowResizeHandle;
    startX: number;
    startY: number;
    initialBounds: ShellWindow["bounds"];
  } | null>(null);
  const startMenuAnchorRef = useRef<HTMLDivElement | null>(null);
  const desktopContextMenuRef = useRef<HTMLDivElement | null>(null);
  const desktopSurfaceRef = useRef<HTMLElement | null>(null);
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
  const [desktopGridViewport, setDesktopGridViewport] = useState(() =>
    readDesktopSurfaceViewport(null),
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
    function updateDesktopGridViewport() {
      setDesktopGridViewport(readDesktopSurfaceViewport(desktopSurfaceRef.current));
    }

    updateDesktopGridViewport();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updateDesktopGridViewport();
          });

    if (desktopSurfaceRef.current !== null) {
      resizeObserver?.observe(desktopSurfaceRef.current);
    }

    window.addEventListener("resize", updateDesktopGridViewport);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateDesktopGridViewport);
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
  const desktopGridMetrics = useMemo(
    () => resolveDesktopGridMetrics(desktopGridViewport),
    [desktopGridViewport],
  );
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
    const routeLaunchKey =
      routeEntry === null || routeEntry.target === null
        ? null
        : buildShellLaunchKey(routeEntry.app, routeEntry.target);
    if (
      !shouldSyncDesktopRouteToActiveWindow({
        activeWindowLaunchKey: activeWindow?.launchKey ?? null,
        activeWindowRoutePath: desiredPath,
        currentPath,
        routeLaunchKey,
      })
    ) {
      return;
    }

    navigate(desiredPath, { replace: true });
  }, [
    activeWindow?.launchKey,
    activeWindow?.routePath,
    location.pathname,
    location.search,
    navigate,
    routeEntry,
  ]);

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
    if (dragState === null) {
      return;
    }

    const activeDrag = dragState;

    function handleWindowMouseMove(event: MouseEvent) {
      const deltaX = event.clientX - activeDrag.startX;
      const deltaY = event.clientY - activeDrag.startY;

      dispatch({
        type: "set_bounds",
        windowId: activeDrag.windowId,
        bounds: normalizeShellWindowBounds(
          {
            ...activeDrag.initialBounds,
            x: activeDrag.initialBounds.x + deltaX,
            y: activeDrag.initialBounds.y + deltaY,
          },
          windowLayerViewport,
        ),
      });
    }

    function stopWindowDrag() {
      setDragState(null);
    }

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "move";

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", stopWindowDrag);
    window.addEventListener("blur", stopWindowDrag);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", stopWindowDrag);
      window.removeEventListener("blur", stopWindowDrag);
    };
  }, [dragState, windowLayerViewport]);

  useEffect(() => {
    if (resizeState === null) {
      return;
    }

    const activeResize = resizeState;

    function handleWindowMouseMove(event: MouseEvent) {
      dispatch({
        type: "set_bounds",
        windowId: activeResize.windowId,
        bounds: resizeShellWindowBounds(
          activeResize.initialBounds,
          windowLayerViewport,
          activeResize.handle,
          event.clientX - activeResize.startX,
          event.clientY - activeResize.startY,
        ),
      });
    }

    function stopWindowResize() {
      setResizeState(null);
    }

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = describeResizeCursor(activeResize.handle);

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", stopWindowResize);
    window.addEventListener("blur", stopWindowResize);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", stopWindowResize);
      window.removeEventListener("blur", stopWindowResize);
    };
  }, [resizeState, windowLayerViewport]);

  useEffect(() => {
    if (state.status !== "authenticated") {
      return;
    }

    return subscribeRealtimeEnvelopes((envelope) => {
      const directEvent = parseDirectChatRealtimeEvent(envelope);
      if (directEvent?.type === "direct_chat.message.updated") {
        // Legacy direct plaintext realtime payload больше не должен влиять
        // на активные direct shell surfaces после de-scope content path.
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
        // Legacy group plaintext realtime payload больше не должен влиять
        // на активные group shell surfaces после de-scope content path.
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

  useEffect(() => {
    if (state.status !== "authenticated") {
      return;
    }

    return subscribeRealtimeEnvelopes((envelope) => {
      const event = parseEncryptedDirectMessageV2RealtimeEvent(envelope);
      if (event === null) {
        return;
      }

      setLiveDirectChats((currentChats) =>
        patchLiveEncryptedDirectChatActivity(currentChats, event),
      );
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
  const desktopEntries = listDesktopEntitiesForSurface(
    desktopRegistryState,
    desktopGridMetrics.capacity,
  );
  const hiddenFolderCount = Math.max(0, allCustomFolders.length - startFolders.length);
  const startMenuMaxHeight = !startMenuState.isOpen
    ? null
    : resolveStartMenuMaxHeight({
        anchorTop:
          startMenuAnchorRef.current?.getBoundingClientRect().top ??
          (typeof window === "undefined"
            ? windowLayerViewport.height
            : Math.max(1, Math.round(window.innerHeight))),
        viewportHeight:
          typeof window === "undefined"
            ? windowLayerViewport.height
            : Math.max(1, Math.round(window.innerHeight)),
      });

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
    targetIndex: number | null;
  }) {
    setSelectedDesktopEntryId(null);
    dispatchDesktopContextMenu({
      type: "open_background",
      x: position.x,
      y: position.y,
      targetIndex: position.targetIndex,
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
      targetIndex: resolveDesktopGridCellIndex(
        {
          x: 48,
          y: 112,
        },
        desktopGridMetrics,
      ),
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
      targetIndex: resolveDesktopGridCellIndex(
        readDesktopSurfacePoint(event.currentTarget, event.clientX, event.clientY),
        desktopGridMetrics,
      ),
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
      title: folder === null ? "Проводник" : `Проводник · ${folder.title}`,
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

  function syncWindowRouteTitle(window: ShellWindow | null, title: string) {
    if (window === null || window.target === null) {
      return;
    }

    const targetKey = window.target.key;
    const normalizedTitle = title.trim();
    if (normalizedTitle === "" || window.title === normalizedTitle) {
      return;
    }

    dispatch({
      type: "sync_target",
      app: shellAppRegistry[window.appId],
      target: {
        ...window.target,
        title: normalizedTitle,
        routePath: window.routePath ?? window.target.routePath,
      },
    });

    if (window.appId === "direct_chat") {
      setDesktopRegistryState((currentState) =>
        upsertDirectChatDesktopEntity(currentState, targetKey, normalizedTitle),
      );
    }

    if (window.appId === "group_chat") {
      setDesktopRegistryState((currentState) =>
        upsertGroupChatDesktopEntity(currentState, targetKey, normalizedTitle),
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

  function setWindowContentMode(
    window: ShellWindow | null,
    contentMode: ShellWindowContentMode,
  ) {
    if (window === null || window.contentMode === null) {
      return;
    }

    dispatch({
      type: "set_content_mode",
      windowId: window.windowId,
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

  function focusWindow(window: ShellWindow) {
    dispatch({ type: "focus", windowId: window.windowId });
    if (window.routePath) {
      navigate(window.routePath);
    }
  }

  function toggleWindowMaximize(window: ShellWindow) {
    dispatch({
      type: window.state === "maximized" ? "restore" : "maximize",
      windowId: window.windowId,
    });
    if (window.routePath) {
      navigate(window.routePath);
    }
  }

  function beginWindowDrag(
    event: ReactMouseEvent<HTMLDivElement>,
    window: ShellWindow,
  ) {
    if (event.button !== 0) {
      return;
    }

    focusWindow(window);
    if (window.state === "maximized") {
      return;
    }

    event.preventDefault();
    setResizeState(null);
    setDragState({
      windowId: window.windowId,
      startX: event.clientX,
      startY: event.clientY,
      initialBounds: normalizeShellWindowBounds(window.bounds, windowLayerViewport),
    });
  }

  function beginWindowResize(
    event: ReactMouseEvent<HTMLDivElement>,
    window: ShellWindow,
    handle: ShellWindowResizeHandle,
  ) {
    if (event.button !== 0) {
      return;
    }

    focusWindow(window);
    if (window.state === "maximized") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setDragState(null);
    setResizeState({
      windowId: window.windowId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      initialBounds: normalizeShellWindowBounds(window.bounds, windowLayerViewport),
    });
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
    const targetIndex =
      desktopContextMenuState.kind === "background"
        ? desktopContextMenuState.targetIndex
        : null;
    closeDesktopContextMenu();

    if (commandId === "open_explorer") {
      launchApp("explorer");
      return;
    }

    const createdFolder = createDesktopBackgroundFolderCreationResult(
      desktopRegistryState,
      targetIndex,
    );
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

  function handleDesktopEntryDragStart(
    event: ReactDragEvent<HTMLButtonElement>,
    entry: DesktopEntity,
  ) {
    setSelectedDesktopEntryId(entry.id);
    setDesktopDragEntryId(entry.id);
    setDesktopDropFolderId(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", entry.id);
  }

  function handleDesktopEntryDragEnd() {
    setDesktopDragEntryId(null);
    setDesktopDropFolderId(null);
  }

  function handleDesktopGridDragOver(event: ReactDragEvent<HTMLElement>) {
    if (desktopDragEntryId === null) {
      return;
    }

    event.preventDefault();
    setDesktopDropFolderId(null);
    event.dataTransfer.dropEffect = "move";
  }

  function handleDesktopGridDrop(event: ReactDragEvent<HTMLElement>) {
    const draggedEntryId = readDraggedDesktopEntryId(event, desktopDragEntryId);
    if (draggedEntryId === null) {
      return;
    }

    event.preventDefault();
    setDesktopDropFolderId(null);
    setDesktopDragEntryId(null);
    setDesktopRegistryState((currentState) =>
      moveDesktopEntityToIndex(
        currentState,
        draggedEntryId,
        resolveDesktopGridCellIndex(
          readDesktopSurfacePoint(
            desktopSurfaceRef.current ?? event.currentTarget,
            event.clientX,
            event.clientY,
          ),
          desktopGridMetrics,
        ),
      ),
    );
  }

  function handleDesktopFolderDragOver(
    event: ReactDragEvent<HTMLButtonElement>,
    entry: DesktopEntity,
  ) {
    const draggedEntryId = readDraggedDesktopEntryId(event, desktopDragEntryId);
    const draggedEntry =
      draggedEntryId === null
        ? null
        : (desktopRegistryState.entries.find((item) => item.id === draggedEntryId) ?? null);
    if (
      entry.kind !== "custom_folder" ||
      draggedEntry === null ||
      (draggedEntry.kind !== "direct_chat" && draggedEntry.kind !== "group_chat")
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setDesktopDropFolderId(entry.folderId);
    event.dataTransfer.dropEffect = "move";
  }

  function handleDesktopFolderDrop(
    event: ReactDragEvent<HTMLButtonElement>,
    entry: DesktopEntity,
  ) {
    const draggedEntryId = readDraggedDesktopEntryId(event, desktopDragEntryId);
    const draggedEntry =
      draggedEntryId === null
        ? null
        : (desktopRegistryState.entries.find((item) => item.id === draggedEntryId) ?? null);
    if (
      entry.kind !== "custom_folder" ||
      draggedEntry === null ||
      (draggedEntry.kind !== "direct_chat" && draggedEntry.kind !== "group_chat")
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    addFolderMember(entry.folderId, {
      kind: draggedEntry.kind,
      targetKey: draggedEntry.targetKey,
    });
    setDesktopDropFolderId(null);
    setDesktopDragEntryId(null);
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

  const activeWindowRouteLocation =
    activeWindow?.routePath === null || activeWindow?.routePath === undefined
      ? null
      : readRoutePathLocation(activeWindow.routePath);
  const baseDesktopShellHost = {
    isDesktopShell: true as const,
    activeWindowId: activeWindow?.windowId ?? null,
    activeWindowContentMode: activeWindow?.contentMode ?? null,
    currentWindowId: activeWindow?.windowId ?? null,
    currentWindowContentMode: activeWindow?.contentMode ?? null,
    currentWindowRoutePath: activeWindow?.routePath ?? null,
    currentWindowPathname: activeWindowRouteLocation?.pathname ?? null,
    currentWindowSearch: activeWindowRouteLocation?.search ?? "",
    currentWindowTargetKey: activeWindow?.target?.key ?? null,
    isCurrentWindowActive: activeWindow !== null,
    desktopGridCapacity: desktopGridMetrics.capacity,
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
  };

  return (
    <DesktopShellHostContext.Provider
      value={baseDesktopShellHost}
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
          ref={desktopSurfaceRef}
          tabIndex={0}
        >
          <div className={styles.desktopProfileTag} data-desktop-background-blocker="true">
            <span className={styles.desktopProfileBrand}>AeroChat</span>
            <span className={styles.desktopProfileUser}>
              @{state.profile.login} · {state.profile.nickname}
            </span>
          </div>

          <div className={styles.desktopStatusArea} data-desktop-background-blocker="true">
            {visibleDirectCallSurface && (
              <section className={styles.callNotice}>
                <div className={styles.callNoticeBody}>
                  <strong className={styles.callTitle}>
                    {visibleDirectCallPeer?.nickname ?? "Direct chat"}
                  </strong>
                  <p className={styles.callText}>
                    {canReturnToCall
                      ? "Звонок активен."
                      : "Есть active call в другом direct chat."}
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
                    {canReturnToCall ? "Вернуться" : "Войти"}
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
                  OK
                </button>
              </section>
            )}
          </div>

          <section
            aria-label="Desktop entrypoints"
            className={styles.desktopGrid}
            onDragOver={handleDesktopGridDragOver}
            onDrop={handleDesktopGridDrop}
            style={{
              gridTemplateColumns: `repeat(${desktopGridMetrics.columns}, minmax(6.9rem, 7.6rem))`,
            }}
          >
            {desktopEntries.map((entry) => {
              const folderUnreadCount =
                entry.kind === "custom_folder"
                  ? getCustomFolderUnreadCount(
                      desktopRegistryState,
                      entry.folderId,
                      desktopUnreadTargetMap,
                    )
                  : 0;
              const folderMemberCount =
                entry.kind === "custom_folder"
                  ? listCustomFolderMemberReferences(
                      desktopRegistryState,
                      entry.folderId,
                    ).length
                  : 0;

              return (
                <article
                  key={entry.id}
                  className={
                    selectedDesktopEntryId === entry.id
                      ? styles.desktopIconCardSelected
                      : styles.desktopIconCard
                  }
                  data-dragging={desktopDragEntryId === entry.id || undefined}
                  data-drop-target={
                    entry.kind === "custom_folder" && desktopDropFolderId === entry.folderId
                      ? "folder"
                      : undefined
                  }
                >
                  <button
                    aria-pressed={selectedDesktopEntryId === entry.id}
                    className={styles.desktopIcon}
                    data-desktop-entry="true"
                    draggable
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
                    onDragEnd={handleDesktopEntryDragEnd}
                    onDragOver={(event) => {
                      handleDesktopFolderDragOver(event, entry);
                    }}
                    onDragStart={(event) => {
                      handleDesktopEntryDragStart(event, entry);
                    }}
                    onDrop={(event) => {
                      handleDesktopFolderDrop(event, entry);
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
                      <ShellIcon
                        className={styles.desktopIconBadge}
                        iconKey={resolveDesktopEntityIconKey(entry, folderMemberCount)}
                        title={entry.title}
                      />
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
              const windowRouteLocation =
                window.routePath === null ? null : readRoutePathLocation(window.routePath);

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
                  data-active={runtimeState.activeWindowId === window.windowId || undefined}
                  data-dragging={dragState?.windowId === window.windowId || undefined}
                  data-resizing={resizeState?.windowId === window.windowId || undefined}
                  onMouseDown={() => {
                    if (window.state === "minimized") {
                      return;
                    }

                    focusWindow(window);
                  }}
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
                    <div
                      aria-label={`Окно ${window.title}`}
                      className={styles.windowTitleBar}
                      onDoubleClick={() => {
                        toggleWindowMaximize(window);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          focusWindow(window);
                          return;
                        }

                        if (event.key === "F10") {
                          event.preventDefault();
                          toggleWindowMaximize(window);
                        }
                      }}
                      onMouseDown={(event) => {
                        beginWindowDrag(event, window);
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <ShellIcon
                        className={styles.windowAppMark}
                        iconKey={resolveShellAppIconKey(window.appId)}
                        title={window.title}
                      />
                      <span className={styles.windowTitleText}>{window.title}</span>
                    </div>
                    <div className={styles.windowControls}>
                      <button
                        aria-label="Свернуть"
                        className={styles.windowControl}
                        onClick={() => {
                          dispatch({ type: "minimize", windowId: window.windowId });
                        }}
                        type="button"
                      >
                        <WindowControlGlyph kind="minimize" />
                      </button>
                      <button
                        aria-label={window.state === "maximized" ? "Восстановить" : "Развернуть"}
                        className={styles.windowControl}
                        onClick={() => {
                          toggleWindowMaximize(window);
                        }}
                        type="button"
                      >
                        <WindowControlGlyph
                          kind={window.state === "maximized" ? "restore" : "maximize"}
                        />
                      </button>
                      <button
                        aria-label="Закрыть"
                        className={styles.windowControlDanger}
                        onClick={() => {
                          dispatch({ type: "close", windowId: window.windowId });
                        }}
                        type="button"
                      >
                        <WindowControlGlyph kind="close" />
                      </button>
                    </div>
                  </div>
                  <div className={styles.windowBody}>
                    <div
                      className={styles.windowBodyViewport}
                      data-scroll-mode={resolveShellWindowScrollMode(window.appId)}
                    >
                      <DesktopShellHostContext.Provider
                        value={{
                          ...baseDesktopShellHost,
                          currentWindowId: window.windowId,
                          currentWindowContentMode: window.contentMode,
                          currentWindowRoutePath: window.routePath,
                          currentWindowPathname: windowRouteLocation?.pathname ?? null,
                          currentWindowSearch: windowRouteLocation?.search ?? "",
                          currentWindowTargetKey: window.target?.key ?? null,
                          isCurrentWindowActive: runtimeState.activeWindowId === window.windowId,
                          setActiveWindowContentMode: (contentMode) => {
                            setWindowContentMode(window, contentMode);
                          },
                          syncCurrentRouteTitle: (title) => {
                            syncWindowRouteTitle(window, title);
                          },
                        }}
                      >
                        <ShellWindowBody window={window} />
                      </DesktopShellHostContext.Provider>
                    </div>
                  </div>
                  {window.state !== "maximized" &&
                    windowResizeHandles.map((handle) => (
                      <div
                        key={handle}
                        aria-hidden="true"
                        className={`${styles.windowResizeHandle} ${describeWindowResizeHandleClass(
                          handle,
                          styles,
                        )}`}
                        onMouseDown={(event) => {
                          beginWindowResize(event, window, handle);
                        }}
                      />
                    ))}
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
              <p className={styles.placeholderLabel}>Папка рабочего стола</p>
              <h2 className={styles.placeholderTitle}>Переименовать папку</h2>
              <p className={styles.placeholderText}>
                Изменится только название этой папки. Ссылки на чаты и группы сохранятся.
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
              <p className={styles.placeholderLabel}>Папка рабочего стола</p>
              <h2 className={styles.placeholderTitle}>Удалить папку «{folderDeleteDialogState.title}»?</h2>
              <p className={styles.placeholderText}>
                Будет удалена только эта папка и её ярлыки. Сами чаты и группы останутся без
                изменений.
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
                  style={
                    startMenuMaxHeight === null
                      ? undefined
                      : {
                          maxHeight: `${startMenuMaxHeight}px`,
                        }
                  }
                >
                  <div className={styles.startMenuHeader}>
                    <div>
                      <strong>{state.profile.nickname}</strong>
                      <span>@{state.profile.login}</span>
                    </div>
                    <small>Быстрый запуск</small>
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
                            <ShellIcon
                              className={styles.startMenuItemBadge}
                              iconKey={resolveShellAppIconKey(item.appId)}
                              title={item.title}
                            />
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
                              <ShellIcon
                                className={styles.startMenuItemBadge}
                                iconKey={resolveRecentItemIconKey(item)}
                                title={item.title}
                              />
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
                                <ShellIcon
                                  className={styles.startMenuItemBadge}
                                  iconKey={memberCount > 0 ? "folder_full" : "folder_empty"}
                                  title={folder.title}
                                />
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
                            openExplorerSection("folders", "Проводник · Папки");
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
            <span className={styles.trayBadge} aria-label="Сетевой статус">
              <ShellIcon className={styles.trayIcon} iconKey="network" title="Сеть" />
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

function readRoutePathLocation(routePath: string): {
  pathname: string;
  search: string;
} {
  const [pathnamePart, ...searchParts] = routePath.split("?");
  const pathname = pathnamePart?.trim() ?? "";
  const searchValue = searchParts.join("?");

  return {
    pathname,
    search: searchValue === "" ? "" : `?${searchValue}`,
  };
}

function ShellWindowBody({ window }: { window: ShellWindow }) {
  const { appId } = window;

  if (!isRouteBackedShellAppId(appId)) {
    return <div className={styles.routeHost}>{renderShellAppContent(appId)}</div>;
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

function resolveShellWindowScrollMode(appId: ShellAppId): "contained" | "document" {
  switch (appId) {
    case "self_chat":
    case "chats":
    case "direct_chat":
    case "groups":
    case "group_chat":
      return "contained";
    default:
      return "document";
  }
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
                      Создайте папку в проводнике, чтобы добавить сюда этот ярлык.
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

const windowResizeHandles: readonly ShellWindowResizeHandle[] = [
  "north",
  "east",
  "south",
  "west",
  "north_east",
  "south_east",
  "south_west",
  "north_west",
];

function describeResizeCursor(handle: ShellWindowResizeHandle): string {
  switch (handle) {
    case "north":
    case "south":
      return "ns-resize";
    case "east":
    case "west":
      return "ew-resize";
    case "north_east":
    case "south_west":
      return "nesw-resize";
    case "north_west":
    case "south_east":
      return "nwse-resize";
  }
}

function describeWindowResizeHandleClass(
  handle: ShellWindowResizeHandle,
  classNames: Record<string, string>,
): string {
  switch (handle) {
    case "north":
      return classNames.windowResizeNorth!;
    case "east":
      return classNames.windowResizeEast!;
    case "south":
      return classNames.windowResizeSouth!;
    case "west":
      return classNames.windowResizeWest!;
    case "north_east":
      return classNames.windowResizeNorthEast!;
    case "south_east":
      return classNames.windowResizeSouthEast!;
    case "south_west":
      return classNames.windowResizeSouthWest!;
    case "north_west":
      return classNames.windowResizeNorthWest!;
  }
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

function readDraggedDesktopEntryId(
  event: ReactDragEvent<HTMLElement>,
  fallbackEntryId: string | null,
): string | null {
  const transferredEntryId = event.dataTransfer.getData("text/plain").trim();
  if (transferredEntryId !== "") {
    return transferredEntryId;
  }

  return fallbackEntryId;
}

function readInitialShellWindowViewport(): ShellWindowViewport {
  if (typeof window === "undefined") {
    return {
      width: 1120,
      height: 760,
    };
  }

  return {
    width: Math.max(1, Math.round(window.innerWidth)),
    height: Math.max(1, Math.round(window.innerHeight - 56)),
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

function readDesktopSurfaceViewport(element: HTMLElement | null): {
  width: number;
  height: number;
} {
  if (element === null) {
    if (typeof window === "undefined") {
      return {
        width: 1280,
        height: 720,
      };
    }

    return {
      width: Math.max(1, Math.round(window.innerWidth)),
      height: Math.max(1, Math.round(window.innerHeight - 56)),
    };
  }

  const rect = element.getBoundingClientRect();
  return {
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

function readDesktopSurfacePoint(
  element: HTMLElement,
  clientX: number,
  clientY: number,
): {
  x: number;
  y: number;
} {
  const rect = element.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
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

function WindowControlGlyph({
  kind,
}: {
  kind: "minimize" | "maximize" | "restore" | "close";
}) {
  return (
    <span
      aria-hidden="true"
      className={styles.windowControlGlyph}
      data-kind={kind}
    />
  );
}
