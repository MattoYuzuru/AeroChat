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
    relaySchema: "ATTACHMENT_RELAY_SCHEMA_LEGACY_PLAINTEXT",
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
        accessToken="token-1"
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
        accessToken="token-1"
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

  it("renders a lazy inline preview block only for MIME-confirmed images", () => {
    const markup = renderToStaticMarkup(
      <MessageAttachmentList
        accessToken="token-1"
        attachments={[
          createAttachment({
            id: "attachment-3",
            fileName: "hero-shot.jpg",
            mimeType: "image/jpeg",
          }),
        ]}
        onDownloadAttachment={vi.fn()}
        onOpenAttachment={vi.fn()}
        pendingAttachmentId={null}
      />,
    );

    expect(markup).toContain("Inline preview");
    expect(markup).toContain("Загружаем изображение...");
    expect(markup).toContain("Открыть изображение hero-shot.jpg");
  });

  it("renders bounded inline audio playback only for MIME-confirmed audio", () => {
    const markup = renderToStaticMarkup(
      <MessageAttachmentList
        accessToken="token-1"
        attachments={[
          createAttachment({
            id: "attachment-5",
            fileName: "voice-note.ogg",
            mimeType: "audio/ogg",
          }),
        ]}
        onDownloadAttachment={vi.fn()}
        onOpenAttachment={vi.fn()}
        pendingAttachmentId={null}
      />,
    );

    expect(markup).toContain("Inline audio");
    expect(markup).toContain("Готовим inline-аудиоплеер...");
    expect(markup).toContain("voice-note.ogg");
  });

  it("renders bounded inline video playback only for MIME-confirmed video", () => {
    const markup = renderToStaticMarkup(
      <MessageAttachmentList
        accessToken="token-1"
        attachments={[
          createAttachment({
            id: "attachment-6",
            fileName: "clip.webm",
            mimeType: "video/webm",
          }),
        ]}
        onDownloadAttachment={vi.fn()}
        onOpenAttachment={vi.fn()}
        pendingAttachmentId={null}
      />,
    );

    expect(markup).toContain("Inline video");
    expect(markup).toContain("Готовим inline-видеоплеер...");
    expect(markup).toContain("clip.webm");
  });

  it("keeps filename-only image guesses on the safe file-card fallback path", () => {
    const markup = renderToStaticMarkup(
      <MessageAttachmentList
        accessToken="token-1"
        attachments={[
          createAttachment({
            id: "attachment-4",
            fileName: "looks-like-image.jpg",
            mimeType: "",
          }),
        ]}
        onDownloadAttachment={vi.fn()}
        onOpenAttachment={vi.fn()}
        pendingAttachmentId={null}
      />,
    );

    expect(markup).not.toContain("Inline preview");
    expect(markup).toContain("looks-like-image.jpg");
  });

  it("keeps filename-only audio and video guesses on the safe file-card fallback path", () => {
    const audioMarkup = renderToStaticMarkup(
      <MessageAttachmentList
        accessToken="token-1"
        attachments={[
          createAttachment({
            id: "attachment-7",
            fileName: "voice-note.ogg",
            mimeType: "",
          }),
        ]}
        onDownloadAttachment={vi.fn()}
        onOpenAttachment={vi.fn()}
        pendingAttachmentId={null}
      />,
    );

    const videoMarkup = renderToStaticMarkup(
      <MessageAttachmentList
        accessToken="token-1"
        attachments={[
          createAttachment({
            id: "attachment-8",
            fileName: "clip.webm",
            mimeType: "",
          }),
        ]}
        onDownloadAttachment={vi.fn()}
        onOpenAttachment={vi.fn()}
        pendingAttachmentId={null}
      />,
    );

    expect(audioMarkup).not.toContain("Готовим inline-аудиоплеер...");
    expect(audioMarkup).toContain("voice-note.ogg");

    expect(videoMarkup).not.toContain("Готовим inline-видеоплеер...");
    expect(videoMarkup).toContain("clip.webm");
  });
});
