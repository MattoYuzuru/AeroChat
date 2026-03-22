import type { SearchResultLane } from "./model";

export interface SearchJumpIntent {
  messageId: string;
  lane: SearchResultLane;
}

export function readSearchJumpIntent(searchParams: URLSearchParams): SearchJumpIntent | null {
  const source = searchParams.get("from")?.trim() ?? "";
  const messageId = searchParams.get("message")?.trim() ?? "";

  if (source !== "search" || messageId === "") {
    return null;
  }

  return {
    messageId,
    lane: searchParams.get("lane")?.trim() === "encrypted" ? "encrypted" : "plaintext",
  };
}

export function clearSearchJumpParams(searchParams: URLSearchParams): URLSearchParams {
  const nextSearchParams = new URLSearchParams(searchParams);
  nextSearchParams.delete("from");
  nextSearchParams.delete("message");
  nextSearchParams.delete("lane");
  return nextSearchParams;
}

export function findJumpTarget<T extends { id: string }>(
  items: T[],
  messageId: string,
): T | null {
  return items.find((item) => item.id === messageId) ?? null;
}
