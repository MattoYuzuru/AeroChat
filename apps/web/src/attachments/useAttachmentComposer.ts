import { useEffect, useReducer, useRef } from "react";
import { gatewayClient } from "../gateway/runtime";
import type { Attachment } from "../gateway/types";
import { describeGatewayError, isGatewayErrorCode } from "../gateway/types";
import {
  attachmentComposerReducer,
  createInitialAttachmentComposerState,
} from "./state";
import {
  clearStoredUploadedAttachment,
  loadStoredUploadedAttachment,
  storeUploadedAttachment,
  type AttachmentComposerScope,
} from "./storage";
import {
  AttachmentUploadAbortedError,
  uploadFileWithProgress,
} from "./upload";

interface UseAttachmentComposerOptions {
  enabled: boolean;
  token: string;
  scope: AttachmentComposerScope | null;
  onUnauthenticated(): void;
}

export function useAttachmentComposer({
  enabled,
  token,
  scope,
  onUnauthenticated,
}: UseAttachmentComposerOptions) {
  const [state, dispatch] = useReducer(
    attachmentComposerReducer,
    undefined,
    createInitialAttachmentComposerState,
  );
  const scopeKind = scope?.kind ?? null;
  const scopeId = scope?.id ?? null;
  const scopeRef = useRef(scope);
  const onUnauthenticatedRef = useRef(onUnauthenticated);
  const fileRef = useRef<File | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    onUnauthenticatedRef.current = onUnauthenticated;
  }, [onUnauthenticated]);

  useEffect(() => {
    scopeRef.current = resolveStableScope(scopeKind, scopeId);
  }, [scopeId, scopeKind]);

  useEffect(() => {
    abortActiveUpload(abortControllerRef);
    fileRef.current = null;

    const nextScope = resolveStableScope(scopeKind, scopeId);

    if (!enabled || nextScope === null) {
      dispatch({ type: "draft_removed" });
      return;
    }
    if (isLegacyPlaintextGroupAttachmentComposerDescoped(nextScope)) {
      clearStoredUploadedAttachment(nextScope);
      dispatch({ type: "draft_removed" });
      return;
    }

    const restoredAttachment = loadStoredUploadedAttachment(nextScope);
    if (restoredAttachment === null) {
      dispatch({ type: "draft_removed" });
      return;
    }

    dispatch({
      type: "restore_uploaded",
      attachment: restoredAttachment,
    });
  }, [enabled, scopeId, scopeKind]);

  async function selectFile(file: File): Promise<Attachment | null> {
    if (!enabled || scopeRef.current === null) {
      return null;
    }
    if (isLegacyPlaintextGroupAttachmentComposerDescoped(scopeRef.current)) {
      abortActiveUpload(abortControllerRef);
      fileRef.current = null;
      clearStoredUploadedAttachment(scopeRef.current);
      dispatch({
        type: "file_selected",
        fileName: file.name,
        mimeType: resolveMimeType(file),
        sizeBytes: file.size,
      });
      dispatch({
        type: "upload_failed",
        message: LEGACY_GROUP_ATTACHMENT_COMPOSER_DESCOPED_MESSAGE,
      });
      return null;
    }

    abortActiveUpload(abortControllerRef);
    fileRef.current = file;
    clearStoredUploadedAttachment(scopeRef.current);
    dispatch({
      type: "file_selected",
      fileName: file.name,
      mimeType: resolveMimeType(file),
      sizeBytes: file.size,
    });

    return uploadSelectedFile(file);
  }

  async function retryUpload(): Promise<Attachment | null> {
    const file = fileRef.current;
    if (!enabled || scopeRef.current === null || file === null) {
      dispatch({
        type: "upload_failed",
        message: "Повторная загрузка недоступна после перезагрузки страницы.",
      });
      return null;
    }
    if (isLegacyPlaintextGroupAttachmentComposerDescoped(scopeRef.current)) {
      clearStoredUploadedAttachment(scopeRef.current);
      dispatch({
        type: "upload_failed",
        message: LEGACY_GROUP_ATTACHMENT_COMPOSER_DESCOPED_MESSAGE,
      });
      return null;
    }

    clearStoredUploadedAttachment(scopeRef.current);
    dispatch({
      type: "file_selected",
      fileName: file.name,
      mimeType: resolveMimeType(file),
      sizeBytes: file.size,
    });
    return uploadSelectedFile(file);
  }

  function removeDraft() {
    abortActiveUpload(abortControllerRef);
    if (scopeRef.current !== null) {
      clearStoredUploadedAttachment(scopeRef.current);
    }
    fileRef.current = null;
    dispatch({ type: "draft_removed" });
  }

  function markSendSucceeded() {
    if (scopeRef.current !== null) {
      clearStoredUploadedAttachment(scopeRef.current);
    }
    fileRef.current = null;
    dispatch({ type: "send_succeeded" });
  }

  function markSendFailed() {
    dispatch({ type: "send_failed" });
  }

  async function uploadSelectedFile(file: File): Promise<Attachment | null> {
    if (scopeRef.current === null) {
      return null;
    }

    try {
      const intent = await gatewayClient.createAttachmentUploadIntent(token, {
        ...(scopeRef.current.kind === "direct"
          ? { directChatId: scopeRef.current.id }
          : { groupId: scopeRef.current.id }),
        fileName: file.name,
        mimeType: resolveMimeType(file),
        sizeBytes: file.size,
      });

      dispatch({
        type: "upload_started",
        attachmentId: intent.attachment.id,
        uploadSessionId: intent.uploadSession.id,
      });

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      await uploadFileWithProgress({
        body: file,
        uploadUrl: intent.uploadSession.uploadUrl,
        httpMethod: intent.uploadSession.httpMethod || "PUT",
        headers: intent.uploadSession.headers,
        signal: abortController.signal,
        onProgress(progress) {
          dispatch({
            type: "upload_progress",
            progress,
          });
        },
      });

      const attachment = await gatewayClient.completeAttachmentUpload(
        token,
        intent.attachment.id,
        intent.uploadSession.id,
      );
      if (scopeRef.current !== null) {
        storeUploadedAttachment(scopeRef.current, attachment);
      }
      dispatch({
        type: "upload_succeeded",
        attachment,
      });
      return attachment;
    } catch (error) {
      if (error instanceof AttachmentUploadAbortedError) {
        return null;
      }

      if (isGatewayErrorCode(error, "unauthenticated")) {
        onUnauthenticatedRef.current();
        return null;
      }

      dispatch({
        type: "upload_failed",
        message: describeGatewayError(error, "Не удалось загрузить файл."),
      });
      return null;
    } finally {
      abortControllerRef.current = null;
    }
  }

  return {
    state,
    selectFile,
    retryUpload,
    removeDraft,
    markSendSucceeded,
    markSendFailed,
    uploadedAttachmentId:
      state.draft?.status === "uploaded" ? state.draft.attachment?.id ?? null : null,
    isUploading:
      state.draft?.status === "preparing" || state.draft?.status === "uploading",
  };
}

function abortActiveUpload(ref: { current: AbortController | null }) {
  if (ref.current === null) {
    return;
  }

  ref.current.abort();
  ref.current = null;
}

function resolveMimeType(file: File): string {
  const normalized = file.type.trim();
  return normalized === "" ? "application/octet-stream" : normalized;
}

export function buildAttachmentComposerScopeKey(
  scope: AttachmentComposerScope | null,
): string | null {
  if (scope === null) {
    return null;
  }

  return `${scope.kind}:${scope.id}`;
}

function resolveStableScope(
  kind: AttachmentComposerScope["kind"] | null,
  id: string | null,
): AttachmentComposerScope | null {
  if (kind === null || id === null) {
    return null;
  }

  return {
    kind,
    id,
  };
}

export const LEGACY_GROUP_ATTACHMENT_COMPOSER_DESCOPED_MESSAGE =
  "Legacy plaintext group attachment path больше не является активным runtime UX. Для groups используйте encrypted media composer.";

export function isLegacyPlaintextGroupAttachmentComposerDescoped(
  scope: AttachmentComposerScope | null,
): scope is AttachmentComposerScope & { kind: "group" } {
  // Групповой plaintext attachment composer больше не должен оживать из session restore
  // или через скрытые voice/video/file fallback entrypoints.
  return scope?.kind === "group";
}
