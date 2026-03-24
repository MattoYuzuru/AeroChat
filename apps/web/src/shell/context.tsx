import { createContext, useContext } from "react";
import type { ShellAppId } from "./runtime";

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

export interface DesktopShellHost {
  isDesktopShell: true;
  launchApp(appId: ShellAppId): void;
  openDirectChat(options: OpenDirectChatWindowOptions): void;
  openGroupChat(options: OpenGroupChatWindowOptions): void;
  syncCurrentRouteTitle(title: string): void;
}

export const DesktopShellHostContext = createContext<DesktopShellHost | null>(null);

export function useDesktopShellHost(): DesktopShellHost | null {
  return useContext(DesktopShellHostContext);
}
