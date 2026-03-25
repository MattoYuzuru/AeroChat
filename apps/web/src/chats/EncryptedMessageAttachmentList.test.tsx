import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EncryptedMediaAttachmentDescriptor } from "../crypto/types";
import { EncryptedMessageAttachmentList } from "./EncryptedMessageAttachmentList";

vi.mock("../crypto/useCryptoRuntime", () => ({
  useCryptoRuntime: () => ({
    decryptEncryptedMediaAttachment: vi.fn(),
  }),
}));

function createAttachment(
  overrides: Partial<EncryptedMediaAttachmentDescriptor> = {},
): EncryptedMediaAttachmentDescriptor {
  return {
    attachmentId: "attachment-1",
    relaySchema: "ATTACHMENT_RELAY_SCHEMA_ENCRYPTED_BLOB_V1",
    fileName: "image.jpg",
    mimeType: "image/jpeg",
    plaintextSizeBytes: 24576,
    ciphertextSizeBytes: 32768,
    ...overrides,
  };
}

describe("EncryptedMessageAttachmentList", () => {
  it("renders generic preview copy without exposing encrypted labels", () => {
    const markup = renderToStaticMarkup(
      <EncryptedMessageAttachmentList
        accessToken="token-1"
        attachments={[createAttachment()]}
      />,
    );

    expect(markup).toContain("Предпросмотр");
    expect(markup).toContain("Готовим изображение...");
    expect(markup).not.toContain("Encrypted preview");
  });

  it("renders generic audio placeholder copy", () => {
    const markup = renderToStaticMarkup(
      <EncryptedMessageAttachmentList
        accessToken="token-1"
        attachments={[
          createAttachment({
            attachmentId: "attachment-2",
            fileName: "voice.ogg",
            mimeType: "audio/ogg",
          }),
        ]}
      />,
    );

    expect(markup).toContain("Аудио");
    expect(markup).toContain("Готовим аудио...");
    expect(markup).not.toContain("Encrypted audio");
  });
});
