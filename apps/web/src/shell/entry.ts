import type { AuthState } from "../auth/context";
import type { ShellBootPreferences } from "./preferences";

export type ShellEntrySurface =
  | "boot"
  | "chooser"
  | "auth"
  | "desktop"
  | "error";

export interface ShellEntryDecisionInput {
  authState: AuthState;
  bootVisible: boolean;
  preferences: ShellBootPreferences;
}

export function shouldRequireShellChooser(
  preferences: ShellBootPreferences,
): boolean {
  return !preferences.chooserCompleted || preferences.rebootToBoot;
}

export function resolveShellEntrySurface(
  input: ShellEntryDecisionInput,
): ShellEntrySurface {
  if (input.authState.status === "error") {
    return "error";
  }

  if (input.bootVisible || input.authState.status === "bootstrapping") {
    return "boot";
  }

  if (shouldRequireShellChooser(input.preferences)) {
    return "chooser";
  }

  if (input.authState.status === "authenticated") {
    return "desktop";
  }

  return "auth";
}
