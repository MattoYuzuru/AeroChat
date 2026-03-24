import { describe, expect, it } from "vitest";
import {
  buildExplorerFolderViewModel,
  buildExplorerSectionViewModel,
  resolveExplorerNavigationTarget,
  resolveExplorerSection,
} from "./explorer-model";
import {
  addCustomFolderMemberReference,
  createCustomFolderDesktopEntity,
  createDesktopUnreadTargetMap,
  createInitialDesktopRegistryState,
  hideDesktopEntity,
  showDesktopEntityOnDesktop,
  upsertDirectChatDesktopEntity,
  upsertGroupChatDesktopEntity,
} from "./desktop-registry";

describe("resolveExplorerSection", () => {
  it("falls back to desktop for unknown section ids", () => {
    expect(resolveExplorerSection("unknown")).toBe("desktop");
    expect(resolveExplorerSection(null)).toBe("desktop");
  });
});

describe("resolveExplorerNavigationTarget", () => {
  it("prioritizes folder target over section query when folder is present", () => {
    expect(
      resolveExplorerNavigationTarget({
        section: "overflow",
        folder: "folder-1",
      }),
    ).toEqual({
      kind: "folder",
      folderId: "folder-1",
    });
  });
});

describe("buildExplorerSectionViewModel", () => {
  it("shows desktop section over visible shell-local desktop entries", () => {
    let state = createInitialDesktopRegistryState();
    state = upsertDirectChatDesktopEntity(state, "chat-1", "Алиса");

    const viewModel = buildExplorerSectionViewModel(state, "desktop");

    expect(viewModel.entities.map((record) => record.entry.title)).toContain("Алиса");
    expect(viewModel.entities.some((record) => record.entry.appId === "explorer")).toBe(true);
  });

  it("keeps hidden entries inside the hidden section with honest state labels", () => {
    let state = createInitialDesktopRegistryState();
    state = upsertDirectChatDesktopEntity(state, "chat-1", "Алиса");
    const entry = state.entries.find((currentEntry) => currentEntry.targetKey === "chat-1");
    state = hideDesktopEntity(state, entry!.id);

    const viewModel = buildExplorerSectionViewModel(state, "hidden");

    expect(viewModel.entities).toHaveLength(1);
    expect(viewModel.entities[0]?.stateLabel).toBe("Скрыт");
    expect(viewModel.entities[0]?.entry.targetKey).toBe("chat-1");
  });

  it("groups visible overflow entries by bucket", () => {
    let state = createInitialDesktopRegistryState();

    for (let index = 1; index <= 12; index += 1) {
      state = upsertDirectChatDesktopEntity(state, `chat-${index}`, `Chat ${index}`);
    }
    state = upsertGroupChatDesktopEntity(state, "group-1", "Design Team");
    for (let index = 1; index <= 6; index += 1) {
      state = createCustomFolderDesktopEntity(state, `Папка ${index}`);
    }

    const viewModel = buildExplorerSectionViewModel(state, "overflow", undefined, 10);

    expect(viewModel.buckets).toEqual([
      expect.objectContaining({
        bucket: "contacts",
        entities: expect.arrayContaining([
          expect.objectContaining({
            entry: expect.objectContaining({
              targetKey: "chat-6",
            }),
          }),
        ]),
      }),
      expect.objectContaining({
        bucket: "groups",
        entities: expect.arrayContaining([
          expect.objectContaining({
            entry: expect.objectContaining({
              targetKey: "group-1",
            }),
          }),
        ]),
      }),
      expect.objectContaining({
        bucket: "folders",
        entities: expect.arrayContaining([
          expect.objectContaining({
            entry: expect.objectContaining({
              kind: "custom_folder",
            }),
          }),
        ]),
      }),
    ]);
  });

  it("shows custom folders in dedicated folders section with unread badge counts", () => {
    let state = createInitialDesktopRegistryState();
    state = upsertDirectChatDesktopEntity(state, "chat-1", "Алиса");
    state = createCustomFolderDesktopEntity(state, "Работа");
    const folder = state.entries.find((entry) => entry.kind === "custom_folder");
    state = addCustomFolderMemberReference(state, folder!.targetKey, {
      kind: "direct_chat",
      targetKey: "chat-1",
    });

    const unreadMap = createDesktopUnreadTargetMap(
      [
        {
          id: "chat-1",
          kind: "DIRECT_CHAT_KIND_PRIMARY",
          participants: [],
          pinnedMessageIds: [],
          encryptedPinnedMessageIds: [],
          unreadCount: 2,
          encryptedUnreadCount: 0,
          createdAt: "2026-03-24T10:00:00Z",
          updatedAt: "2026-03-24T10:00:00Z",
        },
      ],
      [],
    );
    const viewModel = buildExplorerSectionViewModel(state, "folders", unreadMap);

    expect(viewModel.folders).toHaveLength(1);
    expect(viewModel.folders[0]?.folder.title).toBe("Работа");
    expect(viewModel.folders[0]?.unreadCount).toBe(1);
  });

  it("shows promoted entry as desktop-visible again after recovery", () => {
    let state = createInitialDesktopRegistryState();

    for (let index = 1; index <= 12; index += 1) {
      state = upsertDirectChatDesktopEntity(state, `chat-${index}`, `Chat ${index}`);
    }

    state = showDesktopEntityOnDesktop(state, "direct_chat:chat-12");

    const contactsView = buildExplorerSectionViewModel(state, "contacts", undefined, 20);
    const promotedEntry = contactsView.entities.find((record) => record.entry.id === "direct_chat:chat-12");

    expect(promotedEntry?.stateLabel).toBe("На рабочем столе");
  });
});

describe("buildExplorerFolderViewModel", () => {
  it("shows folder members as canonical direct/group targets", () => {
    let state = createInitialDesktopRegistryState();
    state = upsertDirectChatDesktopEntity(state, "chat-1", "Алиса");
    state = upsertGroupChatDesktopEntity(state, "group-1", "Design");
    state = createCustomFolderDesktopEntity(state, "Работа");
    const folder = state.entries.find((entry) => entry.kind === "custom_folder")!;

    state = addCustomFolderMemberReference(state, folder.targetKey, {
      kind: "direct_chat",
      targetKey: "chat-1",
    });
    state = addCustomFolderMemberReference(state, folder.targetKey, {
      kind: "group_chat",
      targetKey: "group-1",
    });

    const viewModel = buildExplorerFolderViewModel(state, folder.targetKey);

    expect(viewModel?.members.map((record) => record.entry.targetKey)).toEqual([
      "chat-1",
      "group-1",
    ]);
  });
});
