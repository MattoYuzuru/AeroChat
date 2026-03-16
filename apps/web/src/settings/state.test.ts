import { describe, expect, it } from "vitest";
import {
  buildSettingsPatch,
  createSettingsForm,
  hasSettingsChanges,
  type SettingsForm,
} from "./state";
import type { Profile } from "../gateway/types";

const profile: Profile = {
  id: "user-1",
  login: "alice",
  nickname: "Alice",
  avatarUrl: null,
  bio: null,
  timezone: "Europe/Berlin",
  profileAccent: "ice-blue",
  statusText: "В сети по вечерам",
  birthday: null,
  country: null,
  city: null,
  readReceiptsEnabled: true,
  presenceEnabled: false,
  typingVisibilityEnabled: true,
  keyBackupStatus: "KEY_BACKUP_STATUS_NOT_CONFIGURED",
  createdAt: "2026-03-23T10:00:00Z",
  updatedAt: "2026-03-23T10:00:00Z",
};

describe("settings state", () => {
  it("creates form from current profile snapshot", () => {
    expect(createSettingsForm(profile)).toEqual<SettingsForm>({
      timezone: "Europe/Berlin",
      profileAccent: "ice-blue",
      statusText: "В сети по вечерам",
      readReceiptsEnabled: true,
      presenceEnabled: false,
      typingVisibilityEnabled: true,
    });
  });

  it("builds patch for gateway update", () => {
    expect(
      buildSettingsPatch({
        timezone: "Asia/Tokyo",
        profileAccent: "silver-sky",
        statusText: "",
        readReceiptsEnabled: false,
        presenceEnabled: true,
        typingVisibilityEnabled: false,
      }),
    ).toEqual({
      timezone: "Asia/Tokyo",
      profileAccent: "silver-sky",
      statusText: "",
      readReceiptsEnabled: false,
      presenceEnabled: true,
      typingVisibilityEnabled: false,
    });
  });

  it("detects when settings differ from current profile", () => {
    expect(hasSettingsChanges(profile, createSettingsForm(profile))).toBe(false);
    expect(
      hasSettingsChanges(profile, {
        ...createSettingsForm(profile),
        readReceiptsEnabled: false,
      }),
    ).toBe(true);
  });
});
