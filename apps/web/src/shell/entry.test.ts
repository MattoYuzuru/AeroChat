import { describe, expect, it } from "vitest";
import { resolveShellEntrySurface, shouldRequireShellChooser } from "./entry";
import type { AuthState } from "../auth/context";

function createAnonymousState(): AuthState {
  return {
    status: "anonymous",
    notice: null,
  };
}

function createAuthenticatedState(): AuthState {
  return {
    status: "authenticated",
    token: "token-1",
    profile: {
      id: "user-1",
      login: "alice",
      nickname: "Alice",
      avatarUrl: null,
      bio: null,
      timezone: null,
      profileAccent: null,
      statusText: null,
      birthday: null,
      country: null,
      city: null,
      readReceiptsEnabled: true,
      presenceEnabled: true,
      typingVisibilityEnabled: true,
      keyBackupStatus: "KEY_BACKUP_STATUS_NOT_CONFIGURED",
      createdAt: "2026-03-24T10:00:00Z",
      updatedAt: "2026-03-24T10:00:00Z",
    },
    notice: null,
  };
}

describe("shell entry logic", () => {
  it("requires chooser on first run and explicit reboot path", () => {
    expect(
      shouldRequireShellChooser({
        chooserCompleted: false,
        rebootToBoot: false,
      }),
    ).toBe(true);
    expect(
      shouldRequireShellChooser({
        chooserCompleted: true,
        rebootToBoot: true,
      }),
    ).toBe(true);
  });

  it("sends valid daily session directly to desktop after boot", () => {
    expect(
      resolveShellEntrySurface({
        authState: createAuthenticatedState(),
        bootVisible: false,
        preferences: {
          chooserCompleted: true,
          rebootToBoot: false,
        },
      }),
    ).toBe("desktop");
  });

  it("sends anonymous first-run flow to chooser before auth app", () => {
    expect(
      resolveShellEntrySurface({
        authState: createAnonymousState(),
        bootVisible: false,
        preferences: {
          chooserCompleted: false,
          rebootToBoot: false,
        },
      }),
    ).toBe("chooser");
  });

  it("keeps boot surface while boot presentation is active", () => {
    expect(
      resolveShellEntrySurface({
        authState: createAnonymousState(),
        bootVisible: true,
        preferences: {
          chooserCompleted: true,
          rebootToBoot: false,
        },
      }),
    ).toBe("boot");
  });
});
