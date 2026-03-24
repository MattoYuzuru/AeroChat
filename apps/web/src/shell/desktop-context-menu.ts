import {
  createCustomFolderDesktopEntity,
  createCustomFolderDesktopEntityAtIndex,
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
      kind: "entry";
      entryId: string;
      x: number;
      y: number;
      isAddToFolderExpanded: boolean;
    }
  | {
      kind: "background";
      x: number;
      y: number;
      targetIndex: number | null;
    };

export type DesktopEntryContextMenuCommandId =
  | "open"
  | "hide"
  | "rename_folder"
  | "delete_folder";
export type DesktopBackgroundContextMenuCommandId = "create_folder" | "open_explorer";
export type DesktopContextMenuCommandId =
  | DesktopEntryContextMenuCommandId
  | DesktopBackgroundContextMenuCommandId;

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
      type: "open_entry";
      entryId: string;
      x: number;
      y: number;
    }
  | {
      type: "open_background";
      x: number;
      y: number;
      targetIndex: number | null;
    }
  | {
      type: "close";
    }
  | {
      type: "toggle_add_to_folder";
    };

export interface DesktopBackgroundFolderCreationResult {
  folderId: string;
  entryId: string;
  name: string;
  registryState: DesktopRegistryState;
}

export const DEFAULT_DESKTOP_BACKGROUND_FOLDER_NAME = "Новая папка";

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
    case "open_entry":
      return {
        kind: "entry",
        entryId: event.entryId,
        x: event.x,
        y: event.y,
        isAddToFolderExpanded: false,
      };
    case "open_background":
      return {
        kind: "background",
        x: event.x,
        y: event.y,
        targetIndex: event.targetIndex,
      };
    case "close":
      return createClosedDesktopContextMenuState();
    case "toggle_add_to_folder":
      if (state.kind !== "entry") {
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

export function listDesktopBackgroundContextMenuItems(): DesktopContextMenuCommandItem[] {
  return [
    createCommandItem("create_folder", "Создать папку"),
    createCommandItem("open_explorer", "Открыть Explorer"),
  ];
}

export function createDesktopBackgroundFolderCreationResult(
  registryState: DesktopRegistryState,
  targetIndex?: number | null,
): DesktopBackgroundFolderCreationResult {
  const folderId = `folder-${registryState.nextFolderSequence}`;
  const name = DEFAULT_DESKTOP_BACKGROUND_FOLDER_NAME;

  return {
    folderId,
    entryId: `custom_folder:${folderId}`,
    name,
    registryState:
      typeof targetIndex === "number"
        ? createCustomFolderDesktopEntityAtIndex(registryState, name, targetIndex)
        : createCustomFolderDesktopEntity(registryState, name),
  };
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
