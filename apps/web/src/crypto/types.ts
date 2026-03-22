import type {
  CryptoDevice,
  CryptoDeviceBundle,
  CryptoDeviceLinkIntent,
  EncryptedDirectMessageV2Envelope,
  EncryptedDirectMessageV2StoredEnvelope,
} from "../gateway/types";

export interface CryptoRuntimeSession {
  token: string;
  profileId: string;
  login: string;
}

export interface LocalCryptoDeviceRecord {
  version: 1;
  accountId: string;
  login: string;
  cryptoDeviceId: string;
  deviceLabel: string;
  cryptoSuite: string;
  status: "active" | "pending_link" | "revoked";
  signedPrekeyId: string;
  bundleDigestBase64: string;
  lastBundleVersion: number;
  lastBundlePublishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  linkIntentId: string | null;
  linkIntentExpiresAt: string | null;
}

export interface LocalCryptoDeviceMaterial {
  record: LocalCryptoDeviceRecord;
  identityPublicKey: CryptoKey;
  identityPrivateKey: CryptoKey;
  signedPrekeyPublicKey: CryptoKey;
  signedPrekeyPrivateKey: CryptoKey;
}

export interface CryptoBundleMaterial {
  cryptoSuite: string;
  identityPublicKeyBase64: string;
  signedPrekeyPublicBase64: string;
  signedPrekeyId: string;
  signedPrekeySignatureBase64: string;
  kemPublicKeyBase64: string | null;
  kemKeyId: string | null;
  kemSignatureBase64: string | null;
  oneTimePrekeysTotal: number;
  oneTimePrekeysAvailable: number;
  bundleDigestBase64: string;
  expiresAt: string | null;
}

export interface CryptoRuntimeSnapshot {
  support: "available" | "unavailable";
  phase: "ready" | "attention_required" | "error";
  localDevice: LocalCryptoDeviceRecord | null;
  devices: CryptoDevice[];
  linkIntents: CryptoDeviceLinkIntent[];
  currentBundle: CryptoDeviceBundle | null;
  canCreatePendingDevice: boolean;
  canApproveLinkIntents: boolean;
  notice: string | null;
  errorMessage: string | null;
}

export interface EncryptedMediaAttachmentDescriptor {
  attachmentId: string;
  relaySchema: "ATTACHMENT_RELAY_SCHEMA_ENCRYPTED_BLOB_V1";
  fileName: string;
  mimeType: string;
  plaintextSizeBytes: number;
  ciphertextSizeBytes: number;
}

export interface PreparedEncryptedMediaRelayUpload {
  draftId: string;
  relayFileName: string;
  relayMimeType: string;
  ciphertextBytes: ArrayBuffer;
  attachment: EncryptedMediaAttachmentDescriptor;
}

export interface DecryptedEncryptedMediaAttachment {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  plaintextBytes: ArrayBuffer;
}

export interface EncryptedDirectMessageV2ReadyProjection {
  status: "ready";
  messageId: string;
  chatId: string;
  senderUserId: string;
  senderCryptoDeviceId: string;
  operationKind: "content" | "edit" | "tombstone";
  targetMessageId: string | null;
  revision: number;
  createdAt: string;
  storedAt: string;
  payloadSchema: "aerochat.web.encrypted_direct_message_v2.payload.v1";
  text: string | null;
  markdownPolicy: string | null;
  attachments: EncryptedMediaAttachmentDescriptor[];
  editedAt: string | null;
  deletedAt: string | null;
}

export interface EncryptedDirectMessageV2DecryptFailure {
  status: "decrypt_failed";
  messageId: string;
  chatId: string;
  senderUserId: string;
  senderCryptoDeviceId: string;
  operationKind: string;
  targetMessageId: string | null;
  revision: number;
  createdAt: string;
  storedAt: string;
  failureKind:
    | "runtime_unavailable"
    | "recipient_mismatch"
    | "invalid_transport_header"
    | "unsupported_transport_schema"
    | "unsupported_operation_kind"
    | "invalid_payload"
    | "aad_mismatch"
    | "decrypt_failed";
}

export type EncryptedDirectMessageV2DecryptedEnvelope =
  | EncryptedDirectMessageV2ReadyProjection
  | EncryptedDirectMessageV2DecryptFailure;

export interface EncryptedDirectMessageV2OutboundSendResult {
  storedEnvelope: EncryptedDirectMessageV2StoredEnvelope;
  localProjection: EncryptedDirectMessageV2ReadyProjection;
}

export interface CryptoRuntimeClient {
  bootstrapSession(session: CryptoRuntimeSession): Promise<CryptoRuntimeSnapshot>;
  createPendingLinkedDevice(session: CryptoRuntimeSession): Promise<CryptoRuntimeSnapshot>;
  publishCurrentBundle(session: CryptoRuntimeSession): Promise<CryptoRuntimeSnapshot>;
  approveLinkIntent(
    session: CryptoRuntimeSession,
    linkIntentId: string,
  ): Promise<CryptoRuntimeSnapshot>;
  decryptEncryptedDirectMessageV2Envelopes(
    session: CryptoRuntimeSession,
    envelopes: EncryptedDirectMessageV2Envelope[],
  ): Promise<EncryptedDirectMessageV2DecryptedEnvelope[]>;
  prepareEncryptedMediaRelayUpload(
    session: CryptoRuntimeSession,
    input: {
      fileName: string;
      mimeType: string;
      fileBytes: ArrayBuffer;
    },
  ): Promise<PreparedEncryptedMediaRelayUpload>;
  decryptEncryptedMediaAttachment(
    session: CryptoRuntimeSession,
    input: {
      attachmentId: string;
      ciphertextBytes: ArrayBuffer;
    },
  ): Promise<DecryptedEncryptedMediaAttachment>;
  sendEncryptedDirectMessageV2Content(
    session: CryptoRuntimeSession,
    input: {
      chatId: string;
      text: string;
      attachmentDrafts?: Array<{
        draftId: string;
        attachmentId: string;
      }>;
    },
  ): Promise<EncryptedDirectMessageV2OutboundSendResult>;
  dispose(): void;
}

export interface CryptoWorkerRequestMap {
  bootstrap: { session: CryptoRuntimeSession };
  createPendingLinkedDevice: { session: CryptoRuntimeSession };
  publishCurrentBundle: { session: CryptoRuntimeSession };
  approveLinkIntent: { session: CryptoRuntimeSession; linkIntentId: string };
  decryptEncryptedDirectMessageV2Envelopes: {
    session: CryptoRuntimeSession;
    envelopes: EncryptedDirectMessageV2Envelope[];
  };
  prepareEncryptedMediaRelayUpload: {
    session: CryptoRuntimeSession;
    input: {
      fileName: string;
      mimeType: string;
      fileBytes: ArrayBuffer;
    };
  };
  decryptEncryptedMediaAttachment: {
    session: CryptoRuntimeSession;
    input: {
      attachmentId: string;
      ciphertextBytes: ArrayBuffer;
    };
  };
  sendEncryptedDirectMessageV2Content: {
    session: CryptoRuntimeSession;
    input: {
      chatId: string;
      text: string;
      attachmentDrafts?: Array<{
        draftId: string;
        attachmentId: string;
      }>;
    };
  };
}

export interface CryptoWorkerResultMap {
  bootstrap: CryptoRuntimeSnapshot;
  createPendingLinkedDevice: CryptoRuntimeSnapshot;
  publishCurrentBundle: CryptoRuntimeSnapshot;
  approveLinkIntent: CryptoRuntimeSnapshot;
  decryptEncryptedDirectMessageV2Envelopes: EncryptedDirectMessageV2DecryptedEnvelope[];
  prepareEncryptedMediaRelayUpload: PreparedEncryptedMediaRelayUpload;
  decryptEncryptedMediaAttachment: DecryptedEncryptedMediaAttachment;
  sendEncryptedDirectMessageV2Content: EncryptedDirectMessageV2OutboundSendResult;
}

export type CryptoWorkerRequest =
  | { id: number; type: "bootstrap"; payload: CryptoWorkerRequestMap["bootstrap"] }
  | {
      id: number;
      type: "createPendingLinkedDevice";
      payload: CryptoWorkerRequestMap["createPendingLinkedDevice"];
    }
  | {
      id: number;
      type: "publishCurrentBundle";
      payload: CryptoWorkerRequestMap["publishCurrentBundle"];
    }
  | {
      id: number;
      type: "approveLinkIntent";
      payload: CryptoWorkerRequestMap["approveLinkIntent"];
    }
  | {
      id: number;
      type: "decryptEncryptedDirectMessageV2Envelopes";
      payload: CryptoWorkerRequestMap["decryptEncryptedDirectMessageV2Envelopes"];
    }
  | {
      id: number;
      type: "prepareEncryptedMediaRelayUpload";
      payload: CryptoWorkerRequestMap["prepareEncryptedMediaRelayUpload"];
    }
  | {
      id: number;
      type: "decryptEncryptedMediaAttachment";
      payload: CryptoWorkerRequestMap["decryptEncryptedMediaAttachment"];
    }
  | {
      id: number;
      type: "sendEncryptedDirectMessageV2Content";
      payload: CryptoWorkerRequestMap["sendEncryptedDirectMessageV2Content"];
    };

export type CryptoWorkerResponse =
  | { id: number; ok: true; result: CryptoWorkerResultMap[keyof CryptoWorkerResultMap] }
  | { id: number; ok: false; message: string };
