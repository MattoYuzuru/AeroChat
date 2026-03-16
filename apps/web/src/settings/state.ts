import type { Profile, UpdateCurrentProfileInput } from "../gateway/types";

export interface SettingsForm {
  timezone: string;
  profileAccent: string;
  statusText: string;
  readReceiptsEnabled: boolean;
  presenceEnabled: boolean;
  typingVisibilityEnabled: boolean;
}

export function createSettingsForm(profile: Profile): SettingsForm {
  return {
    timezone: profile.timezone ?? "",
    profileAccent: profile.profileAccent ?? "",
    statusText: profile.statusText ?? "",
    readReceiptsEnabled: profile.readReceiptsEnabled,
    presenceEnabled: profile.presenceEnabled,
    typingVisibilityEnabled: profile.typingVisibilityEnabled,
  };
}

export function buildSettingsPatch(form: SettingsForm): UpdateCurrentProfileInput {
  return {
    timezone: form.timezone,
    profileAccent: form.profileAccent,
    statusText: form.statusText,
    readReceiptsEnabled: form.readReceiptsEnabled,
    presenceEnabled: form.presenceEnabled,
    typingVisibilityEnabled: form.typingVisibilityEnabled,
  };
}

export function hasSettingsChanges(profile: Profile, form: SettingsForm): boolean {
  const current = createSettingsForm(profile);

  return (
    current.timezone !== form.timezone ||
    current.profileAccent !== form.profileAccent ||
    current.statusText !== form.statusText ||
    current.readReceiptsEnabled !== form.readReceiptsEnabled ||
    current.presenceEnabled !== form.presenceEnabled ||
    current.typingVisibilityEnabled !== form.typingVisibilityEnabled
  );
}
