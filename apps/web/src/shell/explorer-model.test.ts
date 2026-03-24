import { describe, expect, it } from "vitest";
import {
  buildExplorerSectionViewModel,
  resolveExplorerSection,
} from "./explorer-model";
import {
  createInitialDesktopRegistryState,
  hideDesktopEntity,
  showDesktopEntityOnDesktop,
  upsertDirectChatDesktopEntity,
  upsertGroupChatDesktopEntity,
  MAX_VISIBLE_DESKTOP_ENTRIES,
} from "./desktop-registry";

describe("resolveExplorerSection", () => {
  it("falls back to desktop for unknown section ids", () => {
    expect(resolveExplorerSection("unknown")).toBe("desktop");
    expect(resolveExplorerSection(null)).toBe("desktop");
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

    for (let index = 1; index <= MAX_VISIBLE_DESKTOP_ENTRIES; index += 1) {
      state = upsertDirectChatDesktopEntity(state, `chat-${index}`, `Chat ${index}`);
    }
    state = upsertGroupChatDesktopEntity(state, "group-1", "Design Team");

    const viewModel = buildExplorerSectionViewModel(state, "overflow");

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
    ]);
  });

  it("shows promoted entry as desktop-visible again after recovery", () => {
    let state = createInitialDesktopRegistryState();

    for (let index = 1; index <= MAX_VISIBLE_DESKTOP_ENTRIES; index += 1) {
      state = upsertDirectChatDesktopEntity(state, `chat-${index}`, `Chat ${index}`);
    }

    const overflowEntry = state.entries.find(
      (entry) => entry.kind === "direct_chat" && entry.placement === "overflow",
    );
    state = showDesktopEntityOnDesktop(state, overflowEntry!.id);

    const contactsView = buildExplorerSectionViewModel(state, "contacts");
    const promotedEntry = contactsView.entities.find(
      (record) => record.entry.id === overflowEntry!.id,
    );

    expect(promotedEntry?.stateLabel).toBe("На рабочем столе");
  });
});
