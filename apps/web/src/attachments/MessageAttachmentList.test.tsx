import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Attachment } from "../gateway/types";
import { MessageAttachmentList } from "./MessageAttachmentList";

function createAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "attachment-1",
    ownerUserId: "user-1",
    scope: "direct",
    directChatId: "chat-1",
    groupId: null,
    messageId: "message-1",
    fileName: "very-long-filename-for-quarterly-report.pdf",
    mimeType: "application/pdf",
    sizeBytes: 24576,
    status: "attached",
    createdAt: "2026-04-17T10:00:00Z",
    updatedAt: "2026-04-17T10:00:00Z",
    uploadedAt: "2026-04-17T10:00:00Z",
    attachedAt: "2026-04-17T10:00:00Z",
    failedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

describe("MessageAttachmentList", () => {
  it("renders polished attachment cards with explicit actions", () => {
    const markup = renderToStaticMarkup(
      <MessageAttachmentList
        attachments={[createAttachment()]}
        onDownloadAttachment={vi.fn()}
        onOpenAttachment={vi.fn()}
        pendingAttachmentId={null}
        tone="own"
      />,
    );

    expect(markup).toContain("very-long-filename-for-quarterly-report.pdf");
    expect(markup).toContain("Документ");
    expect(markup).toContain("PDF");
    expect(markup).toContain("Открыть");
    expect(markup).toContain("Скачать");
  });

  it("shows pending access resolution state for the active attachment", () => {
    const attachment = createAttachment({
      id: "attachment-2",
      fileName: "archive.7z",
      mimeType: "application/x-7z-compressed",
    });

    const markup = renderToStaticMarkup(
      <MessageAttachmentList
        attachments={[attachment]}
        onDownloadAttachment={vi.fn()}
        onOpenAttachment={vi.fn()}
        pendingAttachmentId="attachment-2"
      />,
    );

    expect(markup).toContain("Готовим ссылку...");
    expect(markup).toContain("Архив / binary");
    expect(markup).toContain("disabled");
  });
});
