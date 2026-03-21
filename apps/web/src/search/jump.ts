export interface SearchJumpIntent {
  messageId: string;
}

export function readSearchJumpIntent(searchParams: URLSearchParams): SearchJumpIntent | null {
  const source = searchParams.get("from")?.trim() ?? "";
  const messageId = searchParams.get("message")?.trim() ?? "";

  if (source !== "search" || messageId === "") {
    return null;
  }

  return {
    messageId,
  };
}

export function clearSearchJumpParams(searchParams: URLSearchParams): URLSearchParams {
  const nextSearchParams = new URLSearchParams(searchParams);
  nextSearchParams.delete("from");
  nextSearchParams.delete("message");
  return nextSearchParams;
}

export function findJumpTarget<T extends { id: string }>(
  items: T[],
  messageId: string,
): T | null {
  return items.find((item) => item.id === messageId) ?? null;
}
