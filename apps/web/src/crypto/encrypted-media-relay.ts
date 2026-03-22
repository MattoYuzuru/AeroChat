import type {
  DecryptedEncryptedMediaAttachment,
  EncryptedMediaAttachmentDescriptor,
  PreparedEncryptedMediaRelayUpload,
} from "./types";

const encryptedAttachmentDescriptorSchema =
  "aerochat.web.encrypted_attachment_descriptor.v1";
const encryptedMediaRelayFileName = "encrypted-media.bin";
const encryptedMediaRelayMimeType = "application/octet-stream";

export interface EncryptedMediaAttachmentDescriptorV1
  extends EncryptedMediaAttachmentDescriptor {
  schema: typeof encryptedAttachmentDescriptorSchema;
  keyBase64: string;
  ivBase64: string;
}

export interface PreparedEncryptedMediaRelayUploadDraft {
  draftId: string;
  relayUpload: PreparedEncryptedMediaRelayUpload;
  descriptor: EncryptedMediaAttachmentDescriptorV1;
}

export async function prepareEncryptedMediaRelayUpload(input: {
  fileName: string;
  mimeType: string;
  fileBytes: ArrayBuffer;
}): Promise<PreparedEncryptedMediaRelayUploadDraft> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const contentKey = await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"],
  );
  const plaintext = new Uint8Array(input.fileBytes);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
    },
    contentKey,
    input.fileBytes,
  );
  const exportedKey = await crypto.subtle.exportKey("raw", contentKey);
  const draftId = crypto.randomUUID();
  const descriptor: EncryptedMediaAttachmentDescriptorV1 = {
    schema: encryptedAttachmentDescriptorSchema,
    attachmentId: "",
    relaySchema: "ATTACHMENT_RELAY_SCHEMA_ENCRYPTED_BLOB_V1",
    fileName: input.fileName.trim() === "" ? "attachment" : input.fileName.trim(),
    mimeType:
      input.mimeType.trim() === "" ? encryptedMediaRelayMimeType : input.mimeType.trim(),
    plaintextSizeBytes: plaintext.byteLength,
    ciphertextSizeBytes: ciphertext.byteLength,
    keyBase64: toBase64(new Uint8Array(exportedKey)),
    ivBase64: toBase64(iv),
  };

  return {
    draftId,
    relayUpload: {
      draftId,
      relayFileName: encryptedMediaRelayFileName,
      relayMimeType: encryptedMediaRelayMimeType,
      ciphertextBytes: ciphertext,
      attachment: toPublicEncryptedMediaAttachmentDescriptor(descriptor),
    },
    descriptor,
  };
}

export function finalizeEncryptedMediaAttachmentDescriptorDraft(
  descriptor: EncryptedMediaAttachmentDescriptorV1,
  attachmentId: string,
): EncryptedMediaAttachmentDescriptorV1 {
  return {
    ...descriptor,
    attachmentId,
  };
}

export function toPublicEncryptedMediaAttachmentDescriptor(
  descriptor: EncryptedMediaAttachmentDescriptorV1,
): EncryptedMediaAttachmentDescriptor {
  return {
    attachmentId: descriptor.attachmentId,
    relaySchema: descriptor.relaySchema,
    fileName: descriptor.fileName,
    mimeType: descriptor.mimeType,
    plaintextSizeBytes: descriptor.plaintextSizeBytes,
    ciphertextSizeBytes: descriptor.ciphertextSizeBytes,
  };
}

export function parseEncryptedMediaAttachmentDescriptor(
  value: unknown,
): EncryptedMediaAttachmentDescriptorV1 | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    value.schema !== encryptedAttachmentDescriptorSchema ||
    value.relaySchema !== "ATTACHMENT_RELAY_SCHEMA_ENCRYPTED_BLOB_V1" ||
    typeof value.attachmentId !== "string" ||
    typeof value.fileName !== "string" ||
    typeof value.mimeType !== "string" ||
    typeof value.plaintextSizeBytes !== "number" ||
    typeof value.ciphertextSizeBytes !== "number" ||
    typeof value.keyBase64 !== "string" ||
    typeof value.ivBase64 !== "string"
  ) {
    return null;
  }

  return {
    schema: encryptedAttachmentDescriptorSchema,
    attachmentId: value.attachmentId,
    relaySchema: "ATTACHMENT_RELAY_SCHEMA_ENCRYPTED_BLOB_V1",
    fileName: value.fileName,
    mimeType: value.mimeType,
    plaintextSizeBytes: value.plaintextSizeBytes,
    ciphertextSizeBytes: value.ciphertextSizeBytes,
    keyBase64: value.keyBase64,
    ivBase64: value.ivBase64,
  };
}

export async function decryptEncryptedMediaAttachment(input: {
  attachmentId: string;
  ciphertextBytes: ArrayBuffer;
  descriptor: EncryptedMediaAttachmentDescriptorV1;
}): Promise<DecryptedEncryptedMediaAttachment> {
  const contentKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(fromBase64(input.descriptor.keyBase64)),
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(fromBase64(input.descriptor.ivBase64)),
    },
    contentKey,
    input.ciphertextBytes,
  );

  return {
    attachmentId: input.attachmentId,
    fileName: input.descriptor.fileName,
    mimeType: input.descriptor.mimeType,
    plaintextBytes: plaintext,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
