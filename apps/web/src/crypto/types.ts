import type {
  CryptoDevice,
  CryptoDeviceBundle,
  CryptoDeviceLinkIntent,
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

export interface CryptoRuntimeClient {
  bootstrapSession(session: CryptoRuntimeSession): Promise<CryptoRuntimeSnapshot>;
  createPendingLinkedDevice(session: CryptoRuntimeSession): Promise<CryptoRuntimeSnapshot>;
  publishCurrentBundle(session: CryptoRuntimeSession): Promise<CryptoRuntimeSnapshot>;
  approveLinkIntent(
    session: CryptoRuntimeSession,
    linkIntentId: string,
  ): Promise<CryptoRuntimeSnapshot>;
  dispose(): void;
}

export interface CryptoWorkerRequestMap {
  bootstrap: { session: CryptoRuntimeSession };
  createPendingLinkedDevice: { session: CryptoRuntimeSession };
  publishCurrentBundle: { session: CryptoRuntimeSession };
  approveLinkIntent: { session: CryptoRuntimeSession; linkIntentId: string };
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
    };

export type CryptoWorkerResponse =
  | { id: number; ok: true; snapshot: CryptoRuntimeSnapshot }
  | { id: number; ok: false; message: string };
