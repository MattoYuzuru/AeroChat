import { createContext, useContext } from "react";
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
  launchApp(appId: ShellAppId): void;
  openDirectChat(options: OpenDirectChatWindowOptions): void;
  openGroupChat(options: OpenGroupChatWindowOptions): void;
  openPersonProfile(options: OpenPersonProfileWindowOptions): void;
  setActiveWindowContentMode(contentMode: ShellWindowContentMode): void;
  syncCurrentRouteTitle(title: string): void;
}

export const DesktopShellHostContext = createContext<DesktopShellHost | null>(null);

export function useDesktopShellHost(): DesktopShellHost | null {
  return useContext(DesktopShellHostContext);
}
