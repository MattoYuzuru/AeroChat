import { createContext, useContext } from "react";
import type { DesktopRegistryState } from "./desktop-registry";
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
  desktopRegistryState: DesktopRegistryState;
  launchApp(appId: ShellAppId): void;
  openDirectChat(options: OpenDirectChatWindowOptions): void;
  openGroupChat(options: OpenGroupChatWindowOptions): void;
  openPersonProfile(options: OpenPersonProfileWindowOptions): void;
  hideDesktopEntry(entryId: string): void;
  showDesktopEntry(entryId: string): void;
  setActiveWindowContentMode(contentMode: ShellWindowContentMode): void;
  syncCurrentRouteTitle(title: string): void;
}

export const DesktopShellHostContext = createContext<DesktopShellHost | null>(null);

export function useDesktopShellHost(): DesktopShellHost | null {
  return useContext(DesktopShellHostContext);
}
