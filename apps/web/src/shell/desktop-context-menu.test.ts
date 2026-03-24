import { describe, expect, it } from "vitest";
import {
  addCustomFolderMemberReference,
  createCustomFolderDesktopEntity,
  createInitialDesktopRegistryState,
  listCustomFolderDesktopEntities,
  readDesktopRegistryState,
  writeDesktopRegistryState,
  type DesktopEntity,
} from "./desktop-registry";
import {
  DEFAULT_DESKTOP_BACKGROUND_FOLDER_NAME,
  createClosedDesktopContextMenuState,
  createDesktopBackgroundFolderCreationResult,
  listDesktopBackgroundContextMenuItems,
  listDesktopContextMenuItems,
  reduceDesktopContextMenuState,
} from "./desktop-context-menu";

describe("desktop context menu", () => {
  it("opens entry menu, toggles folder picker and closes through reducer events", () => {
    const openedState = reduceDesktopContextMenuState(
      createClosedDesktopContextMenuState(),
      {
        type: "open_entry",
        entryId: "direct_chat:chat-1",
        x: 120,
        y: 240,
      },
    );

    expect(openedState).toEqual({
      kind: "entry",
      entryId: "direct_chat:chat-1",
      x: 120,
      y: 240,
      isAddToFolderExpanded: false,
    });

    const expandedState = reduceDesktopContextMenuState(openedState, {
      type: "toggle_add_to_folder",
    });
    expect(expandedState).toMatchObject({
      kind: "entry",
      isAddToFolderExpanded: true,
    });

    expect(
      reduceDesktopContextMenuState(expandedState, {
        type: "close",
      }),
    ).toEqual({
      kind: "closed",
    });
  });

  it("opens and closes background menu through dedicated reducer events", () => {
    const openedState = reduceDesktopContextMenuState(
      createClosedDesktopContextMenuState(),
      {
        type: "open_background",
        x: 84,
        y: 140,
      },
    );

    expect(openedState).toEqual({
      kind: "background",
      x: 84,
      y: 140,
    });

    expect(
      reduceDesktopContextMenuState(openedState, {
        type: "toggle_add_to_folder",
      }),
    ).toEqual(openedState);

    expect(
      reduceDesktopContextMenuState(openedState, {
        type: "close",
      }),
    ).toEqual({
      kind: "closed",
    });
  });

  it("shows only canonical actions for desktop background", () => {
    expect(listDesktopBackgroundContextMenuItems()).toEqual([
      {
        kind: "command",
        id: "create_folder",
        label: "Создать папку",
        tone: "default",
      },
      {
        kind: "command",
        id: "open_explorer",
        label: "Открыть Explorer",
        tone: "default",
      },
    ]);
  });

  it("creates a shell-local folder from desktop background with immediate naming draft", () => {
    const initialState = createInitialDesktopRegistryState();
    const result = createDesktopBackgroundFolderCreationResult(initialState);

    expect(result.folderId).toBe("folder-1");
    expect(result.entryId).toBe("custom_folder:folder-1");
    expect(result.name).toBe(DEFAULT_DESKTOP_BACKGROUND_FOLDER_NAME);

    const createdFolder = listCustomFolderDesktopEntities(result.registryState)[0];
    expect(createdFolder).toMatchObject({
      folderId: "folder-1",
      title: DEFAULT_DESKTOP_BACKGROUND_FOLDER_NAME,
      visibility: "visible",
      placement: "desktop",
    });

    const storage = new Map<string, string>();
    const storageApi = {
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      removeItem(key: string) {
        storage.delete(key);
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
    };
    writeDesktopRegistryState(storageApi, result.registryState);
    const restoredState = readDesktopRegistryState(storageApi);
    expect(listCustomFolderDesktopEntities(restoredState)[0]).toMatchObject({
      folderId: "folder-1",
      title: DEFAULT_DESKTOP_BACKGROUND_FOLDER_NAME,
    });
  });

  it("shows only open for mandatory system apps", () => {
    const state = createInitialDesktopRegistryState();
    const selfChatEntry = state.entries.find(
      (entry): entry is DesktopEntity =>
        entry.kind === "system_app" && entry.appId === "self_chat",
    )!;

    expect(listDesktopContextMenuItems(selfChatEntry, state)).toEqual([
      {
        kind: "command",
        id: "open",
        label: "Открыть",
        tone: "default",
      },
    ]);
  });

  it("shows hide and folder picker for direct chats", () => {
    let state = createInitialDesktopRegistryState();
    state = createCustomFolderDesktopEntity(state, "Работа");
    state = {
      ...state,
      entries: [
        ...state.entries,
        {
          id: "direct_chat:chat-1",
          kind: "direct_chat",
          appId: "direct_chat",
          targetKey: "chat-1",
          title: "Алиса",
          visibility: "visible",
          placement: "desktop",
          overflowBucket: null,
          order: state.nextOrder,
        },
      ],
      nextOrder: state.nextOrder + 1,
    };

    const directChatEntry = state.entries.find(
      (entry): entry is DesktopEntity =>
        entry.kind === "direct_chat" && entry.targetKey === "chat-1",
    )!;

    expect(listDesktopContextMenuItems(directChatEntry, state)).toEqual([
      {
        kind: "command",
        id: "open",
        label: "Открыть",
        tone: "default",
      },
      {
        kind: "command",
        id: "hide",
        label: "Скрыть с рабочего стола",
        tone: "default",
      },
      {
        kind: "folder_picker",
        id: "add_to_folder",
        label: "Добавить в папку",
        folders: [
          {
            folderId: "folder-1",
            title: "Работа",
            isDisabled: false,
          },
        ],
      },
    ]);
  });

  it("marks folder picker entries as disabled when the target already exists in that folder", () => {
    let state = createInitialDesktopRegistryState();
    state = createCustomFolderDesktopEntity(state, "Работа");
    state = {
      ...state,
      entries: [
        ...state.entries,
        {
          id: "group_chat:group-1",
          kind: "group_chat",
          appId: "group_chat",
          targetKey: "group-1",
          title: "Design Team",
          visibility: "visible",
          placement: "desktop",
          overflowBucket: null,
          order: state.nextOrder,
        },
      ],
      nextOrder: state.nextOrder + 1,
    };
    state = addCustomFolderMemberReference(state, "folder-1", {
      kind: "group_chat",
      targetKey: "group-1",
    });

    const groupEntry = state.entries.find(
      (entry): entry is DesktopEntity =>
        entry.kind === "group_chat" && entry.targetKey === "group-1",
    )!;

    const folderPicker = listDesktopContextMenuItems(groupEntry, state)[2];
    expect(folderPicker).toEqual({
      kind: "folder_picker",
      id: "add_to_folder",
      label: "Добавить в папку",
      folders: [
        {
          folderId: "folder-1",
          title: "Работа",
          isDisabled: true,
        },
      ],
    });
  });

  it("shows rename and delete actions for custom folders", () => {
    let state = createInitialDesktopRegistryState();
    state = createCustomFolderDesktopEntity(state, "Фокус");
    const folderEntry = state.entries.find(
      (entry): entry is DesktopEntity => entry.kind === "custom_folder",
    )!;

    expect(listDesktopContextMenuItems(folderEntry, state)).toEqual([
      {
        kind: "command",
        id: "open",
        label: "Открыть",
        tone: "default",
      },
      {
        kind: "command",
        id: "rename_folder",
        label: "Переименовать",
        tone: "default",
      },
      {
        kind: "command",
        id: "hide",
        label: "Скрыть с рабочего стола",
        tone: "default",
      },
      {
        kind: "command",
        id: "delete_folder",
        label: "Удалить папку",
        tone: "danger",
      },
    ]);
  });
});
