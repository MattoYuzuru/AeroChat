import type { Attachment } from "../gateway/types";

export interface AttachmentComposerDraft {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: "preparing" | "uploading" | "uploaded" | "error";
  progress: number;
  attachmentId: string | null;
  uploadSessionId: string | null;
  attachment: Attachment | null;
  errorMessage: string | null;
  restoredFromSession: boolean;
}

export interface AttachmentComposerState {
  draft: AttachmentComposerDraft | null;
}

type AttachmentComposerAction =
  | {
      type: "file_selected";
      fileName: string;
      mimeType: string;
      sizeBytes: number;
    }
  | {
      type: "upload_started";
      attachmentId: string;
      uploadSessionId: string;
    }
  | {
      type: "upload_progress";
      progress: number;
    }
  | {
      type: "upload_succeeded";
      attachment: Attachment;
    }
  | {
      type: "upload_failed";
      message: string;
    }
  | {
      type: "restore_uploaded";
      attachment: Attachment;
    }
  | {
      type: "send_succeeded";
    }
  | {
      type: "send_failed";
    }
  | {
      type: "draft_removed";
    };

export function createInitialAttachmentComposerState(): AttachmentComposerState {
  return {
    draft: null,
  };
}

export function attachmentComposerReducer(
  state: AttachmentComposerState,
  action: AttachmentComposerAction,
): AttachmentComposerState {
  switch (action.type) {
    case "file_selected":
      return {
        draft: {
          fileName: action.fileName,
          mimeType: action.mimeType,
          sizeBytes: action.sizeBytes,
          status: "preparing",
          progress: 0,
          attachmentId: null,
          uploadSessionId: null,
          attachment: null,
          errorMessage: null,
          restoredFromSession: false,
        },
      };
    case "upload_started":
      if (state.draft === null) {
        return state;
      }

      return {
        draft: {
          ...state.draft,
          status: "uploading",
          progress: 0,
          attachmentId: action.attachmentId,
          uploadSessionId: action.uploadSessionId,
          attachment: null,
          errorMessage: null,
          restoredFromSession: false,
        },
      };
    case "upload_progress":
      if (state.draft === null || state.draft.status !== "uploading") {
        return state;
      }

      return {
        draft: {
          ...state.draft,
          progress: clampProgress(action.progress),
        },
      };
    case "upload_succeeded":
      return {
        draft: {
          fileName: action.attachment.fileName,
          mimeType: action.attachment.mimeType,
          sizeBytes: action.attachment.sizeBytes,
          status: "uploaded",
          progress: 100,
          attachmentId: action.attachment.id,
          uploadSessionId: null,
          attachment: action.attachment,
          errorMessage: null,
          restoredFromSession: false,
        },
      };
    case "upload_failed":
      if (state.draft === null) {
        return state;
      }

      return {
        draft: {
          ...state.draft,
          status: "error",
          progress: 0,
          attachmentId: null,
          uploadSessionId: null,
          attachment: null,
          errorMessage: action.message,
        },
      };
    case "restore_uploaded":
      return {
        draft: {
          fileName: action.attachment.fileName,
          mimeType: action.attachment.mimeType,
          sizeBytes: action.attachment.sizeBytes,
          status: "uploaded",
          progress: 100,
          attachmentId: action.attachment.id,
          uploadSessionId: null,
          attachment: action.attachment,
          errorMessage: null,
          restoredFromSession: true,
        },
      };
    case "send_succeeded":
      return createInitialAttachmentComposerState();
    case "send_failed":
      return state;
    case "draft_removed":
      return createInitialAttachmentComposerState();
    default:
      return state;
  }
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value <= 0) {
    return 0;
  }

  if (value >= 99) {
    return 99;
  }

  return Math.round(value);
}
