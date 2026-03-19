import { describe, expect, it } from "vitest";
import {
  attachmentComposerReducer,
  createInitialAttachmentComposerState,
} from "./state";

const uploadedAttachment = {
  id: "attachment-1",
  ownerUserId: "user-1",
  scope: "ATTACHMENT_SCOPE_DIRECT_CHAT",
  directChatId: "chat-1",
  groupId: null,
  messageId: null,
  fileName: "report.pdf",
  mimeType: "application/pdf",
  sizeBytes: 4096,
  status: "ATTACHMENT_STATUS_UPLOADED",
  createdAt: "2026-04-14T10:00:00Z",
  updatedAt: "2026-04-14T10:01:00Z",
  uploadedAt: "2026-04-14T10:01:00Z",
  attachedAt: null,
  failedAt: null,
  deletedAt: null,
};

describe("attachmentComposerReducer", () => {
  it("tracks select -> upload progress -> upload success", () => {
    const selectedState = attachmentComposerReducer(
      createInitialAttachmentComposerState(),
      {
        type: "file_selected",
        fileName: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4096,
      },
    );
    const startedState = attachmentComposerReducer(selectedState, {
      type: "upload_started",
      attachmentId: "attachment-1",
      uploadSessionId: "session-1",
    });
    const progressedState = attachmentComposerReducer(startedState, {
      type: "upload_progress",
      progress: 42,
    });
    const uploadedState = attachmentComposerReducer(progressedState, {
      type: "upload_succeeded",
      attachment: uploadedAttachment,
    });

    expect(selectedState.draft?.status).toBe("preparing");
    expect(startedState.draft?.status).toBe("uploading");
    expect(progressedState.draft?.progress).toBe(42);
    expect(uploadedState.draft).toEqual(
      expect.objectContaining({
        status: "uploaded",
        progress: 100,
        attachmentId: "attachment-1",
        fileName: "report.pdf",
      }),
    );
  });

  it("keeps file metadata and exposes retryable error state after upload failure", () => {
    const selectedState = attachmentComposerReducer(
      createInitialAttachmentComposerState(),
      {
        type: "file_selected",
        fileName: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4096,
      },
    );
    const startedState = attachmentComposerReducer(selectedState, {
      type: "upload_started",
      attachmentId: "attachment-1",
      uploadSessionId: "session-1",
    });
    const failedState = attachmentComposerReducer(startedState, {
      type: "upload_failed",
      message: "Upload не завершился.",
    });

    expect(failedState.draft).toEqual(
      expect.objectContaining({
        status: "error",
        fileName: "report.pdf",
        attachmentId: null,
        errorMessage: "Upload не завершился.",
      }),
    );
  });

  it("clears uploaded draft only after send success and preserves it on send failure", () => {
    const uploadedState = attachmentComposerReducer(
      createInitialAttachmentComposerState(),
      {
        type: "restore_uploaded",
        attachment: uploadedAttachment,
      },
    );
    const failedSendState = attachmentComposerReducer(uploadedState, {
      type: "send_failed",
    });
    const successfulSendState = attachmentComposerReducer(uploadedState, {
      type: "send_succeeded",
    });

    expect(failedSendState.draft?.attachmentId).toBe("attachment-1");
    expect(successfulSendState.draft).toBeNull();
  });
});
