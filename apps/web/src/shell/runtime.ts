export const MAX_OPEN_SHELL_WINDOWS = 10;

export type ShellAppId =
  | "self_chat"
  | "friend_requests"
  | "profile"
  | "people"
  | "chats"
  | "direct_chat"
  | "groups"
  | "group_chat"
  | "search"
  | "settings";

export type ShellLaunchPolicy = "singleton" | "singleton_per_target";
export type ShellWindowState =
  | "open"
  | "focused"
  | "minimized"
  | "maximized"
  | "closed";

export interface ShellLaunchTarget {
  key: string;
  title?: string;
  routePath?: string;
}

export interface ShellAppDefinition {
  appId: ShellAppId;
  title: string;
  launchPolicy: ShellLaunchPolicy;
  routePath: string | null;
}

export interface ShellNotice {
  id: string;
  message: string;
}

export interface ShellWindow {
  windowId: string;
  appId: ShellAppId;
  launchKey: string;
  title: string;
  routePath: string | null;
  target: ShellLaunchTarget | null;
  state: ShellWindowState;
}

export interface ShellRuntimeState {
  windows: ShellWindow[];
  activeWindowId: string | null;
  notice: ShellNotice | null;
  nextWindowSequence: number;
  nextNoticeSequence: number;
}

export interface ShellLaunchRequest {
  appId: ShellAppId;
  target?: ShellLaunchTarget | null;
}

export type ShellRuntimeAction =
  | {
      type: "launch";
      app: ShellAppDefinition;
      target?: ShellLaunchTarget | null;
    }
  | {
      type: "focus";
      windowId: string;
    }
  | {
      type: "minimize";
      windowId: string;
    }
  | {
      type: "maximize";
      windowId: string;
    }
  | {
      type: "restore";
      windowId: string;
    }
  | {
      type: "close";
      windowId: string;
    }
  | {
      type: "dismiss_notice";
    };

export function createInitialShellRuntimeState(): ShellRuntimeState {
  return {
    windows: [],
    activeWindowId: null,
    notice: null,
    nextWindowSequence: 1,
    nextNoticeSequence: 1,
  };
}

export function buildShellLaunchKey(
  app: ShellAppDefinition,
  target: ShellLaunchTarget | null | undefined,
): string {
  if (app.launchPolicy === "singleton") {
    return app.appId;
  }

  const targetKey = target?.key?.trim();
  if (!targetKey) {
    throw new Error(`Launch target is required for app "${app.appId}".`);
  }

  return `${app.appId}:${targetKey}`;
}

export function shellRuntimeReducer(
  state: ShellRuntimeState,
  action: ShellRuntimeAction,
): ShellRuntimeState {
  switch (action.type) {
    case "launch":
      return launchShellWindow(state, action.app, action.target ?? null);
    case "focus":
      return focusShellWindow(state, action.windowId);
    case "minimize":
      return minimizeShellWindow(state, action.windowId);
    case "maximize":
      return maximizeShellWindow(state, action.windowId);
    case "restore":
      return restoreShellWindow(state, action.windowId);
    case "close":
      return closeShellWindow(state, action.windowId);
    case "dismiss_notice":
      return {
        ...state,
        notice: null,
      };
    default:
      return state;
  }
}

export function selectActiveShellWindow(
  state: ShellRuntimeState,
): ShellWindow | null {
  if (state.activeWindowId === null) {
    return null;
  }

  return state.windows.find((window) => window.windowId === state.activeWindowId) ?? null;
}

export function listTaskbarShellWindows(
  state: ShellRuntimeState,
): ShellWindow[] {
  return state.windows.filter((window) => window.state !== "closed");
}

function launchShellWindow(
  state: ShellRuntimeState,
  app: ShellAppDefinition,
  target: ShellLaunchTarget | null,
): ShellRuntimeState {
  const launchKey = buildShellLaunchKey(app, target);
  const existingWindow = state.windows.find((window) => window.launchKey === launchKey);
  if (existingWindow) {
    return focusShellWindow(
      {
        ...state,
        windows: state.windows.map((window) =>
          window.launchKey === launchKey
            ? {
                ...window,
                title: target?.title?.trim() || window.title,
                routePath: target?.routePath ?? window.routePath,
                target: target ?? window.target,
              }
            : window,
        ),
      },
      existingWindow.windowId,
    );
  }

  if (state.windows.length >= MAX_OPEN_SHELL_WINDOWS) {
    return {
      ...state,
      notice: {
        id: `notice-${state.nextNoticeSequence}`,
        message:
          "Нельзя открыть больше 10 окон одновременно. Закройте, сверните или сфокусируйте уже открытое окно.",
      },
      nextNoticeSequence: state.nextNoticeSequence + 1,
    };
  }

  const nextWindow: ShellWindow = {
    windowId: `window-${state.nextWindowSequence}`,
    appId: app.appId,
    launchKey,
    title: target?.title?.trim() || app.title,
    routePath: target?.routePath ?? app.routePath,
    target,
    state: "focused",
  };

  return {
    ...state,
    windows: normalizeFocusState([...state.windows, nextWindow], nextWindow.windowId),
    activeWindowId: nextWindow.windowId,
    notice: null,
    nextWindowSequence: state.nextWindowSequence + 1,
  };
}

function focusShellWindow(
  state: ShellRuntimeState,
  windowId: string,
): ShellRuntimeState {
  if (!state.windows.some((window) => window.windowId === windowId)) {
    return state;
  }

  const reordered = [
    ...state.windows.filter((window) => window.windowId !== windowId),
    ...state.windows.filter((window) => window.windowId === windowId),
  ];

  return {
    ...state,
    windows: normalizeFocusState(reordered, windowId),
    activeWindowId: windowId,
    notice: null,
  };
}

function minimizeShellWindow(
  state: ShellRuntimeState,
  windowId: string,
): ShellRuntimeState {
  if (!state.windows.some((window) => window.windowId === windowId)) {
    return state;
  }

  const windows: ShellWindow[] = state.windows.map((window) =>
    window.windowId === windowId
      ? {
          ...window,
          state: "minimized" satisfies ShellWindowState,
        }
      : window,
  );
  const nextActiveWindow = selectLastRestorableWindow(windows, windowId);

  return {
    ...state,
    windows: normalizeFocusState(windows, nextActiveWindow?.windowId ?? null),
    activeWindowId: nextActiveWindow?.windowId ?? null,
  };
}

function maximizeShellWindow(
  state: ShellRuntimeState,
  windowId: string,
): ShellRuntimeState {
  if (!state.windows.some((window) => window.windowId === windowId)) {
    return state;
  }

  return {
    ...state,
    windows: state.windows.map((window) => {
      if (window.windowId === windowId) {
        return {
          ...window,
          state: "maximized" satisfies ShellWindowState,
        };
      }

      if (window.state === "focused") {
        return {
          ...window,
          state: "open" satisfies ShellWindowState,
        };
      }

      return window;
    }),
    activeWindowId: windowId,
    notice: null,
  };
}

function restoreShellWindow(
  state: ShellRuntimeState,
  windowId: string,
): ShellRuntimeState {
  if (!state.windows.some((window) => window.windowId === windowId)) {
    return state;
  }

  return focusShellWindow(
    {
      ...state,
      windows: state.windows.map<ShellWindow>((window) =>
        window.windowId === windowId &&
        (window.state === "minimized" || window.state === "maximized")
          ? {
              ...window,
              state: "open" satisfies ShellWindowState,
            }
          : window,
      ),
    },
    windowId,
  );
}

function closeShellWindow(
  state: ShellRuntimeState,
  windowId: string,
): ShellRuntimeState {
  if (!state.windows.some((window) => window.windowId === windowId)) {
    return state;
  }

  const windows = state.windows.filter((window) => window.windowId !== windowId);
  const nextActiveWindow = selectLastRestorableWindow(windows, null);

  return {
    ...state,
    windows: normalizeFocusState(windows, nextActiveWindow?.windowId ?? null),
    activeWindowId: nextActiveWindow?.windowId ?? null,
    notice: null,
  };
}

function normalizeFocusState(
  windows: ShellWindow[],
  activeWindowId: string | null,
): ShellWindow[] {
  return windows.map((window) => {
    if (window.state === "minimized") {
      return window;
    }

    if (window.windowId === activeWindowId) {
      return {
        ...window,
        state: window.state === "maximized" ? "maximized" : "focused",
      };
    }

    if (window.state === "focused") {
      return {
        ...window,
        state: "open",
      };
    }

    return window;
  });
}

function selectLastRestorableWindow(
  windows: ShellWindow[],
  excludeWindowId: string | null,
): ShellWindow | null {
  for (let index = windows.length - 1; index >= 0; index -= 1) {
    const window = windows[index];
    if (window === undefined) {
      continue;
    }

    if (window.windowId === excludeWindowId) {
      continue;
    }

    if (window.state !== "minimized" && window.state !== "closed") {
      return window;
    }
  }

  return null;
}
