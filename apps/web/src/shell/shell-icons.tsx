/* eslint-disable react-refresh/only-export-components */
import type { DesktopEntity } from "./desktop-registry";
import type { StartMenuRecentItem } from "./start-menu";
import type { ShellAppId } from "./runtime";

export type ShellIconKey =
  | "self_chat"
  | "group_creator"
  | "direct_chat"
  | "group_chat"
  | "search"
  | "explorer"
  | "folder_empty"
  | "folder_full"
  | "friend_requests"
  | "people"
  | "settings"
  | "groups"
  | "chats"
  | "profile"
  | "person_profile"
  | "network";

export function resolveDesktopEntityIconKey(
  entry: DesktopEntity,
  folderMemberCount: number,
): ShellIconKey {
  if (entry.kind === "custom_folder") {
    return folderMemberCount > 0 ? "folder_full" : "folder_empty";
  }

  if (entry.kind === "direct_chat") {
    return "direct_chat";
  }

  if (entry.kind === "group_chat") {
    return "group_chat";
  }

  return resolveShellAppIconKey(entry.appId);
}

export function resolveRecentItemIconKey(item: StartMenuRecentItem): ShellIconKey {
  if (item.kind === "direct_chat") {
    return "direct_chat";
  }

  if (item.kind === "group_chat") {
    return "group_chat";
  }

  return resolveShellAppIconKey(item.appId);
}

export function resolveShellAppIconKey(appId: ShellAppId): ShellIconKey {
  switch (appId) {
    case "self_chat":
      return "self_chat";
    case "group_creator":
      return "group_creator";
    case "direct_chat":
      return "direct_chat";
    case "group_chat":
    case "groups":
      return "group_chat";
    case "search":
      return "search";
    case "explorer":
      return "explorer";
    case "friend_requests":
      return "friend_requests";
    case "people":
      return "people";
    case "settings":
      return "settings";
    case "chats":
      return "chats";
    case "profile":
      return "profile";
    case "person_profile":
      return "person_profile";
    default:
      return "explorer";
  }
}

export function ShellIcon({
  className,
  iconKey,
  title,
}: {
  className?: string;
  iconKey: ShellIconKey;
  title?: string;
}) {
  return (
    <svg
      aria-hidden={title ? undefined : "true"}
      className={className}
      role={title ? "img" : "presentation"}
      viewBox="0 0 32 32"
    >
      {title ? <title>{title}</title> : null}
      {renderShellIcon(iconKey)}
    </svg>
  );
}

function renderShellIcon(iconKey: ShellIconKey) {
  switch (iconKey) {
    case "self_chat":
      return (
        <>
          <rect x="5" y="6" width="22" height="20" rx="3" fill="#dff4ff" stroke="#1f6aa4" />
          <circle cx="16" cy="12.5" r="4" fill="#f0c089" stroke="#8a5a2a" />
          <path
            d="M10.5 24c0-3.2 2.5-5.8 5.5-5.8s5.5 2.6 5.5 5.8"
            fill="#4b8fd0"
            stroke="#1f5f97"
          />
          <path d="M9 8.5h5.5" stroke="#92cf4b" strokeLinecap="round" strokeWidth="2" />
        </>
      );
    case "group_creator":
      return (
        <>
          <circle cx="11.5" cy="12.5" r="4" fill="#f1c48f" stroke="#905a2d" />
          <circle cx="20.5" cy="13.5" r="3.4" fill="#f7d4a9" stroke="#a36e40" />
          <path d="M5.2 24c0-3.3 2.8-6 6.3-6s6.3 2.7 6.3 6" fill="#74addf" stroke="#1f5f97" />
          <path d="M15.4 24c0-2.6 2.2-4.8 4.9-4.8s4.9 2.2 4.9 4.8" fill="#b2d7f5" stroke="#3b7cb4" />
          <path
            d="M23.2 7.3v4.3M21.1 9.45h4.3"
            stroke="#43a238"
            strokeLinecap="round"
            strokeWidth="2.2"
          />
        </>
      );
    case "direct_chat":
    case "person_profile":
      return (
        <>
          <path
            d="M6.5 24.5c0-4.7 4.3-8.5 9.5-8.5s9.5 3.8 9.5 8.5"
            fill="#8dc0ef"
            stroke="#1e639a"
          />
          <circle cx="16" cy="11.5" r="5" fill="#f2c793" stroke="#925f32" />
          <path d="M21.5 21.5h4.5v4.5" fill="none" stroke="#3f9e39" strokeWidth="2" />
        </>
      );
    case "group_chat":
    case "groups":
      return (
        <>
          <circle cx="12" cy="12.5" r="4" fill="#f1c48f" stroke="#905a2d" />
          <circle cx="20.5" cy="13.5" r="3.5" fill="#f7d4a9" stroke="#a36e40" />
          <path d="M5.5 24c0-3.5 3-6.3 6.5-6.3s6.5 2.8 6.5 6.3" fill="#6fa9de" stroke="#1f5f97" />
          <path d="M15.5 24c0-2.8 2.3-5 5-5s5 2.2 5 5" fill="#a8d0f1" stroke="#3575af" />
        </>
      );
    case "search":
      return (
        <>
          <circle cx="13.5" cy="13.5" r="7" fill="#d8f2ff" stroke="#21679f" strokeWidth="2" />
          <path d="M18.5 18.5 25.5 25.5" stroke="#21679f" strokeLinecap="round" strokeWidth="3" />
          <path d="M13.5 9.5v8" stroke="#7ab83d" strokeLinecap="round" />
          <path d="M9.5 13.5h8" stroke="#7ab83d" strokeLinecap="round" />
        </>
      );
    case "explorer":
      return (
        <>
          <path
            d="M4.5 10.5h10l2.2 2.4h10.8v12.3H4.5z"
            fill="#f5d26a"
            stroke="#9b6d1d"
          />
          <path d="M4.5 10.5h10l1.8 2H27.5v-3.8H4.5z" fill="#f8e29d" stroke="#c59837" />
          <rect x="8" y="16.5" width="16" height="4.5" rx="1" fill="#86b9e8" stroke="#2a6aa3" />
        </>
      );
    case "folder_empty":
      return (
        <>
          <path
            d="M4.5 11h10.2l2.1 2.3h10.7V25H4.5z"
            fill="#efcb62"
            stroke="#986715"
          />
          <path d="M4.5 11h10.2l1.8 2H27.5V9.5H4.5z" fill="#fae49c" stroke="#c8972f" />
        </>
      );
    case "folder_full":
      return (
        <>
          <path
            d="M4.5 11h10.2l2.1 2.3h10.7V25H4.5z"
            fill="#efcb62"
            stroke="#986715"
          />
          <path d="M4.5 11h10.2l1.8 2H27.5V9.5H4.5z" fill="#fae49c" stroke="#c8972f" />
          <rect x="8" y="16.5" width="6.8" height="5.3" rx="1" fill="#8ec0ee" stroke="#28669d" />
          <rect x="16.5" y="15.5" width="7.5" height="6.3" rx="1" fill="#d8efff" stroke="#3a79af" />
        </>
      );
    case "friend_requests":
      return (
        <>
          <circle cx="11.5" cy="12" r="4.5" fill="#f0c693" stroke="#8e5c30" />
          <path d="M5.5 24c0-3.5 2.7-6.3 6-6.3s6 2.8 6 6.3" fill="#83b6e4" stroke="#1e6197" />
          <path
            d="M21 11.5h6M24 8.5v6"
            stroke="#4aa73a"
            strokeLinecap="round"
            strokeWidth="2.2"
          />
        </>
      );
    case "people":
      return (
        <>
          <circle cx="11" cy="12" r="4.1" fill="#f0c693" stroke="#8e5c30" />
          <circle cx="21" cy="13.5" r="3.3" fill="#f6d6ac" stroke="#a06b3f" />
          <path d="M5.5 24c0-3.5 2.7-6.1 5.9-6.1S17.3 20.5 17.3 24" fill="#83b6e4" stroke="#1e6197" />
          <path d="M16 24c0-2.7 2.1-4.8 4.8-4.8s4.8 2.1 4.8 4.8" fill="#c6def6" stroke="#4c84b7" />
        </>
      );
    case "settings":
      return (
        <>
          <circle cx="16" cy="16" r="4.2" fill="#b9d7ee" stroke="#2b699f" strokeWidth="1.5" />
          <path
            d="M16 5.5v3M16 23.5v3M8.5 8.5l2.2 2.2M21.3 21.3l2.2 2.2M5.5 16h3M23.5 16h3M8.5 23.5l2.2-2.2M21.3 10.7l2.2-2.2"
            stroke="#2b699f"
            strokeLinecap="round"
            strokeWidth="2"
          />
        </>
      );
    case "chats":
      return (
        <>
          <path d="M6 8.5h20v11.5H12l-4.5 3z" fill="#d7f0ff" stroke="#21679f" />
          <path d="M10 12h12M10 15.5h8" stroke="#3e8bca" strokeLinecap="round" strokeWidth="1.8" />
        </>
      );
    case "profile":
      return (
        <>
          <rect x="6.5" y="6.5" width="19" height="19" rx="2.5" fill="#dff2ff" stroke="#24699f" />
          <circle cx="16" cy="13" r="4.2" fill="#f0c390" stroke="#8f5b31" />
          <path d="M10 23c0-3.5 2.7-6.2 6-6.2s6 2.7 6 6.2" fill="#75abdf" stroke="#23659b" />
        </>
      );
    case "network":
      return (
        <>
          <circle cx="16" cy="23.4" r="1.7" fill="#3d9c38" stroke="#24699f" strokeWidth="0.6" />
          <path
            d="M7.2 20.8c2.7-3 5.7-4.5 8.8-4.5 3.1 0 6.1 1.5 8.8 4.5M10.2 17.5c1.8-1.9 3.7-2.9 5.8-2.9 2.1 0 4 1 5.8 2.9M13.1 14.2c.9-.9 1.9-1.4 2.9-1.4s2 .5 2.9 1.4"
            fill="none"
            stroke="#3d9c38"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
        </>
      );
  }
}
