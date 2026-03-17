export function extractGroupInviteToken(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") {
    return "";
  }

  const tokenFromAbsoluteURL = extractTokenFromURL(trimmed);
  if (tokenFromAbsoluteURL !== "") {
    return tokenFromAbsoluteURL;
  }

  const tokenFromRelativeURL = extractTokenFromURL(trimmed, "https://aerochat.local");
  if (tokenFromRelativeURL !== "") {
    return tokenFromRelativeURL;
  }

  return trimmed;
}

export function buildGroupInviteUrl(token: string): string {
  const search = `/app/groups?join=${encodeURIComponent(token)}`;
  if (typeof window === "undefined") {
    return search;
  }

  return `${window.location.origin}${search}`;
}

function extractTokenFromURL(input: string, base?: string): string {
  try {
    const url = base ? new URL(input, base) : new URL(input);
    return url.searchParams.get("join")?.trim() ?? url.searchParams.get("token")?.trim() ?? "";
  } catch {
    return "";
  }
}
