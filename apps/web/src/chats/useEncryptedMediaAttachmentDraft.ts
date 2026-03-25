import { useEffect, useRef, useState } from "react";
import { uploadFileWithProgress, AttachmentUploadAbortedError } from "../attachments/upload";
import { useCryptoRuntime } from "../crypto/useCryptoRuntime";
import { gatewayClient } from "../gateway/runtime";
import { describeGatewayError, isGatewayErrorCode } from "../gateway/types";
import type { EncryptedMediaAttachmentDescriptor } from "../crypto/types";

interface UseEncryptedMediaAttachmentDraftOptions {
  enabled: boolean;
  token: string;
  scope:
    | {
        kind: "direct" | "group";
        id: string;
      }
    | null;
  onUnauthenticated(): void;
}

interface UploadedEncryptedMediaAttachmentDraft {
  status: "uploaded";
  fileName: string;
  mimeType: string;
  plaintextSizeBytes: number;
  ciphertextSizeBytes: number;
  attachment: EncryptedMediaAttachmentDescriptor;
  draftId: string;
  attachmentId: string;
}

interface PendingEncryptedMediaAttachmentDraft {
  status: "preparing" | "uploading";
  fileName: string;
  mimeType: string;
  plaintextSizeBytes: number;
  ciphertextSizeBytes: number;
  progress: number;
}

interface ErrorEncryptedMediaAttachmentDraft {
  status: "error";
  fileName: string;
  mimeType: string;
  plaintextSizeBytes: number;
  ciphertextSizeBytes: number;
  errorMessage: string;
}

export type EncryptedMediaAttachmentDraftState =
  | PendingEncryptedMediaAttachmentDraft
  | UploadedEncryptedMediaAttachmentDraft
  | ErrorEncryptedMediaAttachmentDraft;

interface PreparedEncryptedUploadRefValue {
  draftId: string;
  relayFileName: string;
  relayMimeType: string;
  ciphertextBytes: ArrayBuffer;
  attachment: EncryptedMediaAttachmentDescriptor;
}

export function useEncryptedMediaAttachmentDraft({
  enabled,
  token,
  scope,
  onUnauthenticated,
}: UseEncryptedMediaAttachmentDraftOptions) {
  const cryptoRuntime = useCryptoRuntime();
  const [draft, setDraft] = useState<EncryptedMediaAttachmentDraftState | null>(null);
  const preparedUploadRef = useRef<PreparedEncryptedUploadRefValue | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const scopeRef = useRef<UseEncryptedMediaAttachmentDraftOptions["scope"]>(scope);
  const onUnauthenticatedRef = useRef(onUnauthenticated);

  useEffect(() => {
    onUnauthenticatedRef.current = onUnauthenticated;
  }, [onUnauthenticated]);

  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  useEffect(() => {
    abortActiveUpload(abortControllerRef);
    preparedUploadRef.current = null;
    setDraft(null);
  }, [enabled, scope]);

  async function selectFile(file: File): Promise<{
    draftId: string;
    attachmentId: string;
  } | null> {
    if (!enabled || scopeRef.current === null) {
      return null;
    }

    abortActiveUpload(abortControllerRef);
    preparedUploadRef.current = null;
    const mimeType = resolveMimeType(file.type);
    setDraft({
      status: "preparing",
      fileName: file.name,
      mimeType,
      plaintextSizeBytes: file.size,
      ciphertextSizeBytes: 0,
      progress: 0,
    });

    try {
      const prepared = await cryptoRuntime.prepareEncryptedMediaRelayUpload({
        fileName: file.name,
        mimeType,
        fileBytes: await file.arrayBuffer(),
      });
      if (prepared === null) {
        return null;
      }

      preparedUploadRef.current = prepared;
      return uploadPreparedDraft(prepared, {
        fileName: file.name,
        mimeType,
        plaintextSizeBytes: file.size,
      });
    } catch (error) {
      setDraft({
        status: "error",
        fileName: file.name,
        mimeType,
        plaintextSizeBytes: file.size,
        ciphertextSizeBytes: 0,
        errorMessage:
          error instanceof Error && error.message.trim() !== ""
            ? error.message
            : "Не удалось подготовить файл.",
      });
      return null;
    }
  }

  async function retryUpload(): Promise<{
    draftId: string;
    attachmentId: string;
  } | null> {
    if (!enabled || scopeRef.current === null || preparedUploadRef.current === null) {
      setDraft((current) =>
        current === null
          ? null
          : {
              status: "error",
              fileName: current.fileName,
              mimeType: current.mimeType,
              plaintextSizeBytes: current.plaintextSizeBytes,
              ciphertextSizeBytes: current.ciphertextSizeBytes,
              errorMessage: "Нельзя повторить загрузку после сброса черновика.",
            },
      );
      return null;
    }

    return uploadPreparedDraft(preparedUploadRef.current, {
      fileName: preparedUploadRef.current.attachment.fileName,
      mimeType: preparedUploadRef.current.attachment.mimeType,
      plaintextSizeBytes: preparedUploadRef.current.attachment.plaintextSizeBytes,
    });
  }

  function removeDraft() {
    abortActiveUpload(abortControllerRef);
    preparedUploadRef.current = null;
    setDraft(null);
  }

  function markSendSucceeded() {
    preparedUploadRef.current = null;
    setDraft(null);
  }

  function markSendFailed() {
    setDraft((current) => current);
  }

  async function uploadPreparedDraft(
    prepared: PreparedEncryptedUploadRefValue,
    metadata: {
      fileName: string;
      mimeType: string;
      plaintextSizeBytes: number;
    },
  ): Promise<{
    draftId: string;
    attachmentId: string;
  } | null> {
    const activeScope = scopeRef.current;
    if (activeScope === null) {
      return null;
    }

    try {
      setDraft({
        status: "uploading",
        fileName: metadata.fileName,
        mimeType: metadata.mimeType,
        plaintextSizeBytes: metadata.plaintextSizeBytes,
        ciphertextSizeBytes: prepared.attachment.ciphertextSizeBytes,
        progress: 0,
      });

      const intent = await gatewayClient.createAttachmentUploadIntent(token, {
        ...(activeScope.kind === "direct"
          ? { directChatId: activeScope.id }
          : { groupId: activeScope.id }),
        fileName: prepared.relayFileName,
        mimeType: prepared.relayMimeType,
        sizeBytes: prepared.attachment.ciphertextSizeBytes,
        relaySchema: "ATTACHMENT_RELAY_SCHEMA_ENCRYPTED_BLOB_V1",
      });

      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      await uploadFileWithProgress({
        body: prepared.ciphertextBytes,
        uploadUrl: intent.uploadSession.uploadUrl,
        httpMethod: intent.uploadSession.httpMethod || "PUT",
        headers: intent.uploadSession.headers,
        signal: abortController.signal,
        onProgress(progress) {
          setDraft({
            status: "uploading",
            fileName: metadata.fileName,
            mimeType: metadata.mimeType,
            plaintextSizeBytes: metadata.plaintextSizeBytes,
            ciphertextSizeBytes: prepared.attachment.ciphertextSizeBytes,
            progress,
          });
        },
      });

      const attachment = await gatewayClient.completeAttachmentUpload(
        token,
        intent.attachment.id,
        intent.uploadSession.id,
      );
      const resolvedDescriptor: EncryptedMediaAttachmentDescriptor = {
        ...prepared.attachment,
        attachmentId: attachment.id,
      };

      setDraft({
        status: "uploaded",
        fileName: metadata.fileName,
        mimeType: metadata.mimeType,
        plaintextSizeBytes: metadata.plaintextSizeBytes,
        ciphertextSizeBytes: prepared.attachment.ciphertextSizeBytes,
        attachment: resolvedDescriptor,
        draftId: prepared.draftId,
        attachmentId: attachment.id,
      });
      return {
        draftId: prepared.draftId,
        attachmentId: attachment.id,
      };
    } catch (error) {
      if (error instanceof AttachmentUploadAbortedError) {
        return null;
      }
      if (isGatewayErrorCode(error, "unauthenticated")) {
        onUnauthenticatedRef.current();
        return null;
      }

      setDraft({
        status: "error",
        fileName: metadata.fileName,
        mimeType: metadata.mimeType,
        plaintextSizeBytes: metadata.plaintextSizeBytes,
        ciphertextSizeBytes: prepared.attachment.ciphertextSizeBytes,
        errorMessage: describeGatewayError(error, "Не удалось загрузить файл."),
      });
      return null;
    } finally {
      abortControllerRef.current = null;
    }
  }

  return {
    draft,
    selectFile,
    retryUpload,
    removeDraft,
    markSendSucceeded,
    markSendFailed,
    isUploading:
      draft?.status === "preparing" || draft?.status === "uploading",
    uploadedDraft:
      draft?.status === "uploaded"
        ? {
            draftId: draft.draftId,
            attachmentId: draft.attachmentId,
          }
        : null,
  };
}

function resolveMimeType(mimeType: string): string {
  const normalized = mimeType.trim();
  return normalized === "" ? "application/octet-stream" : normalized;
}

function abortActiveUpload(ref: { current: AbortController | null }) {
  if (ref.current === null) {
    return;
  }

  ref.current.abort();
  ref.current = null;
}
