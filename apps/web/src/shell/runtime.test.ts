import { describe, expect, it } from "vitest";
import { shellAppRegistry } from "../app/app-routes";
import {
  createInitialShellRuntimeState,
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

  it("allows different singleton_per_target launch keys when runtime policy needs it", () => {
    let state = createInitialShellRuntimeState();
    const directChatApp: ShellAppDefinition = {
      appId: "chats",
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
      "chats:chat-1",
      "chats:chat-2",
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

  it("refuses the eleventh window with a bounded notice", () => {
    let state = createInitialShellRuntimeState();

    for (let index = 0; index < MAX_OPEN_SHELL_WINDOWS; index += 1) {
      state = shellRuntimeReducer(state, {
        type: "launch",
        app: {
          appId: "chats",
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
        appId: "groups",
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
