import type { Attachment } from "../gateway/types";

export type AttachmentComposerScope =
  | {
      kind: "direct";
      id: string;
    }
  | {
      kind: "group";
      id: string;
    };

const storagePrefix = "aerochat.attachment-composer";

export function loadStoredUploadedAttachment(
  scope: AttachmentComposerScope,
): Attachment | null {
  const storage = resolveSessionStorage();
  if (storage === null) {
    return null;
  }

  const rawValue = storage.getItem(buildStorageKey(scope));
  if (rawValue === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Attachment;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.id !== "string" ||
      parsed.id === ""
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function storeUploadedAttachment(
  scope: AttachmentComposerScope,
  attachment: Attachment,
) {
  const storage = resolveSessionStorage();
  if (storage === null) {
    return;
  }

  storage.setItem(buildStorageKey(scope), JSON.stringify(attachment));
}

export function clearStoredUploadedAttachment(scope: AttachmentComposerScope) {
  const storage = resolveSessionStorage();
  if (storage === null) {
    return;
  }

  storage.removeItem(buildStorageKey(scope));
}

function buildStorageKey(scope: AttachmentComposerScope): string {
  return `${storagePrefix}:${scope.kind}:${scope.id}`;
}

function resolveSessionStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
