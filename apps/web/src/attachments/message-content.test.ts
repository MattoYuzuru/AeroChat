import { describe, expect, it } from "vitest";
import {
  canSubmitMessageComposer,
  hasRenderableMessageText,
  normalizeComposerMessageText,
} from "./message-content";

describe("message-content helpers", () => {
  it("allows send for meaningful text or uploaded attachment", () => {
    expect(
      canSubmitMessageComposer({
        text: "hello",
        uploadedAttachmentId: null,
        isUploading: false,
      }),
    ).toBe(true);

    expect(
      canSubmitMessageComposer({
        text: "   ",
        uploadedAttachmentId: "attachment-1",
        isUploading: false,
      }),
    ).toBe(true);

    expect(
      canSubmitMessageComposer({
        text: "hello",
        uploadedAttachmentId: null,
        isUploading: true,
      }),
    ).toBe(true);

    expect(
      canSubmitMessageComposer({
        text: "   ",
        uploadedAttachmentId: null,
        isUploading: true,
      }),
    ).toBe(false);
  });

  it("respects read-only and empty-message constraints", () => {
    expect(
      canSubmitMessageComposer({
        text: "hello",
        uploadedAttachmentId: null,
        isUploading: false,
        canSendMessages: false,
      }),
    ).toBe(false);

    expect(
      canSubmitMessageComposer({
        text: "   ",
        uploadedAttachmentId: null,
        isUploading: false,
      }),
    ).toBe(false);
  });

  it("normalizes composer text and detects renderable message text", () => {
    expect(normalizeComposerMessageText("  hello \n")).toBe("hello");
    expect(hasRenderableMessageText({ text: "file note" })).toBe(true);
    expect(hasRenderableMessageText(null)).toBe(false);
  });
});
