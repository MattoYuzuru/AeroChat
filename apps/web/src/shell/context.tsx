import { createContext, useContext, useMemo } from "react";
import { useLocation } from "react-router-dom";
import type {
  DesktopFolderReferenceTarget,
  DesktopRegistryState,
  DesktopUnreadTargetMap,
} from "./desktop-registry";
import type { ShellAppId, ShellWindowContentMode } from "./runtime";

export interface OpenDirectChatWindowOptions {
  chatId: string;
  title?: string;
  searchParams?: URLSearchParams | null;
}

export interface OpenGroupChatWindowOptions {
  groupId: string;
  title?: string;
  searchParams?: URLSearchParams | null;
}

export interface OpenPersonProfileWindowOptions {
  userId: string;
  title?: string;
  searchParams?: URLSearchParams | null;
}

export interface DesktopShellHost {
  isDesktopShell: true;
  activeWindowId: string | null;
  activeWindowContentMode: ShellWindowContentMode | null;
  currentWindowId: string | null;
  currentWindowContentMode: ShellWindowContentMode | null;
  currentWindowRoutePath: string | null;
  currentWindowPathname: string | null;
  currentWindowSearch: string;
  currentWindowTargetKey: string | null;
  isCurrentWindowActive: boolean;
  desktopGridCapacity: number;
  desktopRegistryState: DesktopRegistryState;
  desktopUnreadTargetMap: DesktopUnreadTargetMap;
  launchApp(
    appId: ShellAppId,
    options?: {
      routePath?: string | null;
      title?: string;
    },
  ): void;
  openDirectChat(options: OpenDirectChatWindowOptions): void;
  openGroupChat(options: OpenGroupChatWindowOptions): void;
  openCustomFolder(folderId: string): void;
  openPersonProfile(options: OpenPersonProfileWindowOptions): void;
  createCustomFolder(name: string): string;
  renameCustomFolder(folderId: string, name: string): void;
  deleteCustomFolder(folderId: string): void;
  addFolderMember(folderId: string, target: DesktopFolderReferenceTarget): void;
  removeFolderMember(referenceId: string): void;
  hideDesktopEntry(entryId: string): void;
  showDesktopEntry(entryId: string): void;
  setActiveWindowContentMode(contentMode: ShellWindowContentMode): void;
  syncCurrentRouteTitle(title: string): void;
}

export const DesktopShellHostContext = createContext<DesktopShellHost | null>(null);

export function useDesktopShellHost(): DesktopShellHost | null {
  return useContext(DesktopShellHostContext);
}

export interface DesktopShellWindowLocation {
  pathname: string;
  search: string;
  routePath: string;
}

export function useDesktopShellWindowLocation(): DesktopShellWindowLocation {
  const desktopShellHost = useDesktopShellHost();
  const location = useLocation();

  return useMemo(() => {
    if (
      desktopShellHost === null ||
      desktopShellHost.currentWindowPathname === null
    ) {
      return {
        pathname: location.pathname,
        search: location.search,
        routePath: `${location.pathname}${location.search}`,
      };
    }

    return {
      pathname: desktopShellHost.currentWindowPathname,
      search: desktopShellHost.currentWindowSearch,
      routePath:
        desktopShellHost.currentWindowRoutePath ??
        `${desktopShellHost.currentWindowPathname}${desktopShellHost.currentWindowSearch}`,
    };
  }, [
    desktopShellHost,
    location.pathname,
    location.search,
  ]);
}
