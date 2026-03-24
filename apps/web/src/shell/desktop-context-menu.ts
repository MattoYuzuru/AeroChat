import {
  isDesktopEntityHideable,
  listCustomFolderDesktopEntities,
  listCustomFolderMemberReferences,
  type DesktopEntity,
  type DesktopFolderReferenceTarget,
  type DesktopRegistryState,
} from "./desktop-registry";

export type DesktopContextMenuState =
  | {
      kind: "closed";
    }
  | {
      kind: "open";
      entryId: string;
      x: number;
      y: number;
      isAddToFolderExpanded: boolean;
    };

export type DesktopContextMenuCommandId =
  | "open"
  | "hide"
  | "rename_folder"
  | "delete_folder";

export interface DesktopContextMenuCommandItem {
  kind: "command";
  id: DesktopContextMenuCommandId;
  label: string;
  tone: "default" | "danger";
}

export interface DesktopContextMenuFolderItem {
  folderId: string;
  title: string;
  isDisabled: boolean;
}

export interface DesktopContextMenuFolderPickerItem {
  kind: "folder_picker";
  id: "add_to_folder";
  label: string;
  folders: DesktopContextMenuFolderItem[];
}

export type DesktopContextMenuItem =
  | DesktopContextMenuCommandItem
  | DesktopContextMenuFolderPickerItem;

export type DesktopContextMenuEvent =
  | {
      type: "open";
      entryId: string;
      x: number;
      y: number;
    }
  | {
      type: "close";
    }
  | {
      type: "toggle_add_to_folder";
    };

export function createClosedDesktopContextMenuState(): DesktopContextMenuState {
  return {
    kind: "closed",
  };
}

export function reduceDesktopContextMenuState(
  state: DesktopContextMenuState,
  event: DesktopContextMenuEvent,
): DesktopContextMenuState {
  switch (event.type) {
    case "open":
      return {
        kind: "open",
        entryId: event.entryId,
        x: event.x,
        y: event.y,
        isAddToFolderExpanded: false,
      };
    case "close":
      return createClosedDesktopContextMenuState();
    case "toggle_add_to_folder":
      if (state.kind !== "open") {
        return state;
      }

      return {
        ...state,
        isAddToFolderExpanded: !state.isAddToFolderExpanded,
      };
  }
}

export function listDesktopContextMenuItems(
  entry: DesktopEntity,
  registryState: DesktopRegistryState,
): DesktopContextMenuItem[] {
  if (entry.kind === "system_app") {
    return [createCommandItem("open", "Открыть")];
  }

  if (entry.kind === "custom_folder") {
    return [
      createCommandItem("open", "Открыть"),
      createCommandItem("rename_folder", "Переименовать"),
      ...(isDesktopEntityHideable(entry)
        ? [createCommandItem("hide", "Скрыть с рабочего стола")]
        : []),
      createCommandItem("delete_folder", "Удалить папку", "danger"),
    ];
  }

  const target: DesktopFolderReferenceTarget = {
    kind: entry.kind,
    targetKey: entry.targetKey,
  };

  return [
    createCommandItem("open", "Открыть"),
    createCommandItem("hide", "Скрыть с рабочего стола"),
    {
      kind: "folder_picker",
      id: "add_to_folder",
      label: "Добавить в папку",
      folders: listCustomFolderDesktopEntities(registryState).map((folder) => ({
        folderId: folder.folderId,
        title: folder.title,
        isDisabled: hasFolderTargetReference(registryState, folder.folderId, target),
      })),
    },
  ];
}

function createCommandItem(
  id: DesktopContextMenuCommandId,
  label: string,
  tone: DesktopContextMenuCommandItem["tone"] = "default",
): DesktopContextMenuCommandItem {
  return {
    kind: "command",
    id,
    label,
    tone,
  };
}

function hasFolderTargetReference(
  registryState: DesktopRegistryState,
  folderId: string,
  target: DesktopFolderReferenceTarget,
): boolean {
  return listCustomFolderMemberReferences(registryState, folderId).some(
    (reference) =>
      reference.target.kind === target.kind &&
      reference.target.targetKey === target.targetKey,
  );
}
