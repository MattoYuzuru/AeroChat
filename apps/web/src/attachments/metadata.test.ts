import { describe, expect, it } from "vitest";
import {
  canRenderInlineAudioPreview,
  canRenderInlineImagePreview,
  canRenderInlineVideoPreview,
  classifyAttachmentForDisplay,
  describeAttachmentMimeType,
  formatAttachmentSize,
  getAttachmentInlinePreviewKind,
  getAttachmentDisplayDescriptor,
} from "./metadata";

describe("attachment metadata helpers", () => {
  it("formats file sizes with bounded human-readable units", () => {
    expect(formatAttachmentSize(0)).toBe("0 Б");
    expect(formatAttachmentSize(999)).toBe("999 Б");
    expect(formatAttachmentSize(1536)).toBe("1.5 КБ");
    expect(formatAttachmentSize(5 * 1024 * 1024)).toBe("5.0 МБ");
    expect(formatAttachmentSize(3 * 1024 * 1024 * 1024)).toBe("3.0 ГБ");
  });

  it("uses conservative display-oriented categorization", () => {
    expect(
      classifyAttachmentForDisplay({
        fileName: "photo.jpeg",
        mimeType: "image/jpeg",
      }),
    ).toBe("image");

    expect(
      classifyAttachmentForDisplay({
        fileName: "voice-note.ogg",
        mimeType: "",
      }),
    ).toBe("audio");

    expect(
      classifyAttachmentForDisplay({
        fileName: "report-final.DOCX",
        mimeType: "application/octet-stream",
      }),
    ).toBe("document");

    expect(
      classifyAttachmentForDisplay({
        fileName: "release.tar.gz",
        mimeType: "",
      }),
    ).toBe("archive-binary");

    expect(
      classifyAttachmentForDisplay({
        fileName: "unknown.payload",
        mimeType: "",
      }),
    ).toBe("generic-file");
  });

  it("returns human-friendly MIME and display labels", () => {
    expect(describeAttachmentMimeType("application/pdf")).toBe("PDF");
    expect(describeAttachmentMimeType("video/webm")).toBe("WEBM");
    expect(describeAttachmentMimeType("")).toBe("неизвестный MIME");

    expect(
      getAttachmentDisplayDescriptor({
        fileName: "spreadsheet.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).toEqual({
      category: "document",
      badgeLabel: "DOC",
      categoryLabel: "Документ",
      mimeLabel: "XLSX",
    });
  });

  it("allows inline preview only for MIME-confirmed raster images", () => {
    expect(canRenderInlineImagePreview("image/jpeg")).toBe(true);
    expect(canRenderInlineImagePreview(" image/webp ")).toBe(true);
    expect(canRenderInlineImagePreview("image/svg+xml")).toBe(false);
    expect(canRenderInlineImagePreview("")).toBe(false);
    expect(canRenderInlineImagePreview("application/octet-stream")).toBe(false);
  });

  it("allows audio and video inline preview only for MIME-confirmed media", () => {
    expect(getAttachmentInlinePreviewKind(" audio/ogg ")).toBe("audio");
    expect(getAttachmentInlinePreviewKind("video/mp4")).toBe("video");
    expect(getAttachmentInlinePreviewKind("")).toBeNull();
    expect(getAttachmentInlinePreviewKind("application/octet-stream")).toBeNull();

    expect(canRenderInlineAudioPreview("audio/ogg")).toBe(true);
    expect(canRenderInlineAudioPreview("voice-note.ogg")).toBe(false);

    expect(canRenderInlineVideoPreview("video/webm")).toBe(true);
    expect(canRenderInlineVideoPreview("clip.mp4")).toBe(false);
  });
});
