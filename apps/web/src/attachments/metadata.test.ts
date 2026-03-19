import { describe, expect, it } from "vitest";
import {
  classifyAttachmentForDisplay,
  describeAttachmentMimeType,
  formatAttachmentSize,
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
});
