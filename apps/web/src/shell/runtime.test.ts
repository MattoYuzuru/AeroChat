import { describe, expect, it } from "vitest";
import { shellAppRegistry } from "../app/app-routes";
import {
  createInitialShellRuntimeState,
  listTaskbarShellWindows,
  MAX_OPEN_SHELL_WINDOWS,
  shellRuntimeReducer,
  type ShellAppDefinition,
} from "./runtime";

describe("shellRuntimeReducer", () => {
  it("reuses singleton windows by focus instead of duplicating", () => {
    let state = createInitialShellRuntimeState();

    state = shellRuntimeReducer(state, {
      type: "launch",
      app: shellAppRegistry.search,
    });
    const firstWindowId = state.activeWindowId;

    state = shellRuntimeReducer(state, {
      type: "launch",
      app: shellAppRegistry.search,
    });

    expect(state.windows).toHaveLength(1);
    expect(state.activeWindowId).toBe(firstWindowId);
  });

  it("keeps friend_requests as one singleton window with stable taskbar identity on relaunch", () => {
    let state = createInitialShellRuntimeState();

    state = shellRuntimeReducer(state, {
      type: "launch",
      app: shellAppRegistry.friend_requests,
      target: {
        key: "friend_requests",
        title: "Заявки",
        routePath: "/app/friend-requests",
      },
    });
    const friendRequestsWindowId = state.activeWindowId;

    state = shellRuntimeReducer(state, {
      type: "minimize",
      windowId: friendRequestsWindowId!,
    });
    state = shellRuntimeReducer(state, {
      type: "launch",
      app: shellAppRegistry.friend_requests,
      target: {
        key: "friend_requests",
        title: "Заявки",
        routePath: "/app/friend-requests?from=desktop",
      },
    });

    expect(state.windows).toHaveLength(1);
    expect(state.windows[0]?.windowId).toBe(friendRequestsWindowId);
    expect(state.windows[0]?.routePath).toBe("/app/friend-requests?from=desktop");
    expect(state.windows[0]?.state).toBe("focused");
    expect(listTaskbarShellWindows(state)).toHaveLength(1);
    expect(listTaskbarShellWindows(state)[0]?.appId).toBe("friend_requests");
  });

  it("keeps self_chat as one singleton window with stable taskbar identity on relaunch", () => {
    let state = createInitialShellRuntimeState();

    state = shellRuntimeReducer(state, {
      type: "launch",
      app: shellAppRegistry.self_chat,
      target: {
        key: "self_chat",
        title: "Я",
        routePath: "/app/self",
      },
    });
    const selfChatWindowId = state.activeWindowId;

    state = shellRuntimeReducer(state, {
      type: "minimize",
      windowId: selfChatWindowId!,
    });
    state = shellRuntimeReducer(state, {
      type: "launch",
      app: shellAppRegistry.self_chat,
      target: {
        key: "self_chat",
        title: "Я",
        routePath: "/app/self?from=desktop",
      },
    });

    expect(state.windows).toHaveLength(1);
    expect(state.windows[0]?.windowId).toBe(selfChatWindowId);
    expect(state.windows[0]?.routePath).toBe("/app/self?from=desktop");
    expect(state.windows[0]?.state).toBe("focused");
    expect(listTaskbarShellWindows(state)).toHaveLength(1);
    expect(listTaskbarShellWindows(state)[0]?.appId).toBe("self_chat");
  });

  it("keeps explorer as one singleton organizer window while updating section route", () => {
    let state = createInitialShellRuntimeState();

    state = shellRuntimeReducer(state, {
      type: "launch",
      app: shellAppRegistry.explorer,
      target: {
        key: "explorer",
        title: "Explorer",
        routePath: "/app/explorer",
      },
    });
    const explorerWindowId = state.activeWindowId;

    state = shellRuntimeReducer(state, {
      type: "minimize",
      windowId: explorerWindowId!,
    });
    state = shellRuntimeReducer(state, {
      type: "launch",
      app: shellAppRegistry.explorer,
      target: {
        key: "explorer",
        title: "Explorer",
        routePath: "/app/explorer?section=overflow",
      },
    });

    expect(state.windows).toHaveLength(1);
    expect(state.windows[0]?.windowId).toBe(explorerWindowId);
    expect(state.windows[0]?.appId).toBe("explorer");
    expect(state.windows[0]?.routePath).toBe("/app/explorer?section=overflow");
    expect(state.windows[0]?.state).toBe("focused");
  });

  it("allows different singleton_per_target launch keys when runtime policy needs it", () => {
    let state = createInitialShellRuntimeState();
    const directChatApp: ShellAppDefinition = {
      appId: "direct_chat",
      title: "Direct chat",
      launchPolicy: "singleton_per_target",
      routePath: "/app/chats",
    };

    state = shellRuntimeReducer(state, {
      type: "launch",
      app: directChatApp,
      target: {
        key: "chat-1",
        title: "Alice",
        routePath: "/app/chats?chat=chat-1",
      },
    });
    state = shellRuntimeReducer(state, {
      type: "launch",
      app: directChatApp,
      target: {
        key: "chat-2",
        title: "Bob",
        routePath: "/app/chats?chat=chat-2",
      },
    });

    expect(state.windows).toHaveLength(2);
    expect(state.windows.map((window) => window.launchKey)).toEqual([
      "direct_chat:chat-1",
      "direct_chat:chat-2",
    ]);
  });

  it("reuses the same person_profile window for the same user while keeping chat windows separate", () => {
    let state = createInitialShellRuntimeState();

    state = shellRuntimeReducer(state, {
      type: "launch",
      app: shellAppRegistry.person_profile,
      target: {
        key: "user-7",
        title: "Alice",
        routePath: "/app/people?person=user-7",
      },
    });
    const firstProfileWindowId = state.activeWindowId;

    state = shellRuntimeReducer(state, {
      type: "launch",
      app: shellAppRegistry.person_profile,
      target: {
        key: "user-7",
        title: "Alice A.",
        routePath: "/app/people?person=user-7&from=search",
      },
    });

    expect(state.windows).toHaveLength(1);
    expect(state.activeWindowId).toBe(firstProfileWindowId);
    expect(state.windows[0]?.routePath).toBe("/app/people?person=user-7&from=search");
    expect(state.windows[0]?.title).toBe("Alice A.");

    state = shellRuntimeReducer(state, {
      type: "launch",
      app: shellAppRegistry.direct_chat,
      target: {
        key: "chat-3",
        title: "Alice",
        routePath: "/app/chats?chat=chat-3",
      },
    });

    expect(listTaskbarShellWindows(state).map((window) => window.appId)).toEqual([
      "person_profile",
      "direct_chat",
    ]);
  });

  it("restores a minimized window when it is focused from taskbar", () => {
    let state = createInitialShellRuntimeState();

    state = shellRuntimeReducer(state, {
      type: "launch",
      app: shellAppRegistry.settings,
    });
    const settingsWindowId = state.activeWindowId!;

    state = shellRuntimeReducer(state, {
      type: "minimize",
      windowId: settingsWindowId,
    });
    expect(state.windows[0]?.state).toBe("minimized");

    state = shellRuntimeReducer(state, {
      type: "restore",
      windowId: settingsWindowId,
    });
    expect(state.windows[0]?.state).toBe("focused");
    expect(state.activeWindowId).toBe(settingsWindowId);
  });

  it("keeps same direct chat window instance while preserving live info mode across minimize/restore", () => {
    let state = createInitialShellRuntimeState();

    state = shellRuntimeReducer(state, {
      type: "launch",
      app: shellAppRegistry.direct_chat,
      target: {
        key: "chat-1",
        title: "Alice",
        routePath: "/app/chats?chat=chat-1",
      },
    });
    const directWindow = state.windows[0]!;

    state = shellRuntimeReducer(state, {
      type: "set_content_mode",
      windowId: directWindow.windowId,
      contentMode: "info",
    });
    state = shellRuntimeReducer(state, {
      type: "minimize",
      windowId: directWindow.windowId,
    });
    state = shellRuntimeReducer(state, {
      type: "restore",
      windowId: directWindow.windowId,
    });

    expect(state.windows).toHaveLength(1);
    expect(state.windows[0]?.windowId).toBe(directWindow.windowId);
    expect(state.windows[0]?.launchKey).toBe(directWindow.launchKey);
    expect(state.windows[0]?.contentMode).toBe("info");
    expect(state.windows[0]?.state).toBe("focused");
  });

  it("resets an already open direct chat back to thread mode on canonical relaunch without duplicating taskbar identity", () => {
    let state = createInitialShellRuntimeState();

    state = shellRuntimeReducer(state, {
      type: "launch",
      app: shellAppRegistry.direct_chat,
      target: {
        key: "chat-1",
        title: "Alice",
        routePath: "/app/chats?chat=chat-1",
      },
    });
    const directWindow = state.windows[0]!;

    state = shellRuntimeReducer(state, {
      type: "set_content_mode",
      windowId: directWindow.windowId,
      contentMode: "info",
    });
    state = shellRuntimeReducer(state, {
      type: "launch",
      app: shellAppRegistry.direct_chat,
      target: {
        key: "chat-1",
        title: "Alice",
        routePath: "/app/chats?chat=chat-1&message=message-7",
      },
    });

    expect(state.windows).toHaveLength(1);
    expect(listTaskbarShellWindows(state)).toHaveLength(1);
    expect(state.windows[0]?.windowId).toBe(directWindow.windowId);
    expect(state.windows[0]?.launchKey).toBe(directWindow.launchKey);
    expect(state.windows[0]?.contentMode).toBe("thread");
    expect(state.windows[0]?.routePath).toBe("/app/chats?chat=chat-1&message=message-7");
  });

  it("keeps live info mode on route target sync but returns to default thread after close and reopen", () => {
    let state = createInitialShellRuntimeState();

    state = shellRuntimeReducer(state, {
      type: "launch",
      app: shellAppRegistry.group_chat,
      target: {
        key: "group-4",
        title: "Design",
        routePath: "/app/groups?group=group-4",
      },
    });
    const groupWindow = state.windows[0]!;

    state = shellRuntimeReducer(state, {
      type: "set_content_mode",
      windowId: groupWindow.windowId,
      contentMode: "info",
    });
    state = shellRuntimeReducer(state, {
      type: "sync_target",
      app: shellAppRegistry.group_chat,
      target: {
        key: "group-4",
        title: "Design Team",
        routePath: "/app/groups?group=group-4",
      },
    });

    expect(state.windows[0]?.windowId).toBe(groupWindow.windowId);
    expect(state.windows[0]?.contentMode).toBe("info");
    expect(state.windows[0]?.title).toBe("Design Team");

    state = shellRuntimeReducer(state, {
      type: "close",
      windowId: groupWindow.windowId,
    });
    state = shellRuntimeReducer(state, {
      type: "launch",
      app: shellAppRegistry.group_chat,
      target: {
        key: "group-4",
        title: "Design Team",
        routePath: "/app/groups?group=group-4",
      },
    });

    expect(state.windows).toHaveLength(1);
    expect(state.windows[0]?.windowId).not.toBe(groupWindow.windowId);
    expect(state.windows[0]?.launchKey).toBe(groupWindow.launchKey);
    expect(state.windows[0]?.contentMode).toBe("thread");
  });

  it("refuses the eleventh window with a bounded notice", () => {
    let state = createInitialShellRuntimeState();

    for (let index = 0; index < MAX_OPEN_SHELL_WINDOWS; index += 1) {
      state = shellRuntimeReducer(state, {
        type: "launch",
        app: {
          appId: "direct_chat",
          title: `Chat ${index + 1}`,
          launchPolicy: "singleton_per_target",
          routePath: "/app/chats",
        } satisfies ShellAppDefinition,
        target: {
          key: `chat-${index + 1}`,
          title: `Chat ${index + 1}`,
          routePath: `/app/chats?chat=chat-${index + 1}`,
        },
      });
    }

    state = shellRuntimeReducer(state, {
      type: "launch",
      app: {
        appId: "group_chat",
        title: "Group 11",
        launchPolicy: "singleton_per_target",
        routePath: "/app/groups",
      } satisfies ShellAppDefinition,
      target: {
        key: "group-11",
        title: "Group 11",
        routePath: "/app/groups?group=group-11",
      },
    });

    expect(state.windows).toHaveLength(MAX_OPEN_SHELL_WINDOWS);
    expect(state.notice?.message).toContain("Нельзя открыть больше 10 окон");
  });
});
