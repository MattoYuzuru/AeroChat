import type { CryptoDeviceLinkApprovalProof } from "../gateway/types";
import type {
  CryptoBundleMaterial,
  LocalCryptoDeviceMaterial,
  LocalCryptoDeviceRecord,
} from "./types";

const cryptoSuite = "webcrypto-p256-foundation-v1";

export interface CryptoMaterialFactory {
  isSupported(): boolean;
  createDeviceMaterial(input: {
    accountId: string;
    login: string;
    deviceLabel: string;
    deviceId: string;
    status: "active" | "pending_link";
    bundleVersion: number;
    publishedAt: string | null;
    linkIntentId: string | null;
    linkIntentExpiresAt: string | null;
  }): Promise<{
    material: LocalCryptoDeviceMaterial;
    bundle: CryptoBundleMaterial;
  }>;
  buildBundle(material: LocalCryptoDeviceMaterial): Promise<CryptoBundleMaterial>;
  buildLinkApprovalProof(
    material: LocalCryptoDeviceMaterial,
    input: {
      linkIntentId: string;
      approverCryptoDeviceId: string;
      pendingCryptoDeviceId: string;
      pendingBundleDigestBase64: string;
      approvalChallengeBase64: string;
      challengeExpiresAt: string;
      issuedAt: string;
    },
  ): Promise<CryptoDeviceLinkApprovalProof>;
  syncRecordFromServer(
    material: LocalCryptoDeviceMaterial,
    input: {
      bundleDigestBase64: string;
      bundleVersion: number;
      publishedAt: string | null;
      status: "active" | "pending_link" | "revoked";
      linkIntentId: string | null;
      linkIntentExpiresAt: string | null;
    },
  ): LocalCryptoDeviceMaterial;
}

export function createWebCryptoMaterialFactory(): CryptoMaterialFactory {
  return {
    isSupported() {
      return (
        typeof crypto !== "undefined" &&
        typeof crypto.subtle !== "undefined" &&
        typeof crypto.getRandomValues !== "undefined"
      );
    },

    async createDeviceMaterial(input) {
      const createdAt = new Date().toISOString();
      const identityKeyPair = await crypto.subtle.generateKey(
        {
          name: "ECDSA",
          namedCurve: "P-256",
        },
        false,
        ["sign", "verify"],
      );
      const signedPrekeyPair = await crypto.subtle.generateKey(
        {
          name: "ECDH",
          namedCurve: "P-256",
        },
        false,
        ["deriveKey", "deriveBits"],
      );

      const record: LocalCryptoDeviceRecord = {
        version: 1,
        accountId: input.accountId,
        login: input.login,
        cryptoDeviceId: input.deviceId,
        deviceLabel: input.deviceLabel,
        cryptoSuite,
        status: input.status,
        signedPrekeyId: createRandomID(),
        bundleDigestBase64: "",
        lastBundleVersion: input.bundleVersion,
        lastBundlePublishedAt: input.publishedAt,
        createdAt,
        updatedAt: createdAt,
        linkIntentId: input.linkIntentId,
        linkIntentExpiresAt: input.linkIntentExpiresAt,
      };

      const material: LocalCryptoDeviceMaterial = {
        record,
        identityPublicKey: identityKeyPair.publicKey,
        identityPrivateKey: identityKeyPair.privateKey,
        signedPrekeyPublicKey: signedPrekeyPair.publicKey,
        signedPrekeyPrivateKey: signedPrekeyPair.privateKey,
      };
      const bundle = await buildBundleFromMaterial(material);
      material.record.bundleDigestBase64 = bundle.bundleDigestBase64;

      return { material, bundle };
    },

    buildBundle(material) {
      return buildBundleFromMaterial(material);
    },

    async buildLinkApprovalProof(material, input) {
      const payload: CryptoDeviceLinkApprovalProof["payload"] = {
        version: 1,
        linkIntentId: input.linkIntentId,
        approverCryptoDeviceId: input.approverCryptoDeviceId,
        pendingCryptoDeviceId: input.pendingCryptoDeviceId,
        pendingBundleDigestBase64: input.pendingBundleDigestBase64,
        approvalChallengeBase64: input.approvalChallengeBase64,
        challengeExpiresAt: input.challengeExpiresAt,
        issuedAt: input.issuedAt,
      };
      const signature = await crypto.subtle.sign(
        {
          name: "ECDSA",
          hash: "SHA-256",
        },
        material.identityPrivateKey,
        cloneBuffer(buildCryptoDeviceLinkApprovalSigningMessage(payload)),
      );

      return {
        payload,
        signatureBase64: toBase64(new Uint8Array(signature)),
      };
    },

    syncRecordFromServer(material, input) {
      return {
        ...material,
        record: {
          ...material.record,
          bundleDigestBase64: input.bundleDigestBase64,
          lastBundleVersion: input.bundleVersion,
          lastBundlePublishedAt: input.publishedAt,
          status: input.status,
          linkIntentId: input.linkIntentId,
          linkIntentExpiresAt: input.linkIntentExpiresAt,
          updatedAt: new Date().toISOString(),
        },
      };
    },
  };
}

async function buildBundleFromMaterial(
  material: LocalCryptoDeviceMaterial,
): Promise<CryptoBundleMaterial> {
  const identityPublicKey = await exportPublicKey(material.identityPublicKey);
  const signedPrekeyPublic = await exportPublicKey(material.signedPrekeyPublicKey);
  const signedPrekeySignature = await signSignedPrekey(
    material.identityPrivateKey,
    signedPrekeyPublic,
  );
  const digest = await computeBundleDigest({
    cryptoSuite: material.record.cryptoSuite,
    identityPublicKey,
    signedPrekeyPublic,
    signedPrekeyId: material.record.signedPrekeyId,
    signedPrekeySignature,
    oneTimePrekeysTotal: 0,
    oneTimePrekeysAvailable: 0,
  });

  return {
    cryptoSuite: material.record.cryptoSuite,
    identityPublicKeyBase64: toBase64(identityPublicKey),
    signedPrekeyPublicBase64: toBase64(signedPrekeyPublic),
    signedPrekeyId: material.record.signedPrekeyId,
    signedPrekeySignatureBase64: toBase64(signedPrekeySignature),
    kemPublicKeyBase64: null,
    kemKeyId: null,
    kemSignatureBase64: null,
    oneTimePrekeysTotal: 0,
    oneTimePrekeysAvailable: 0,
    bundleDigestBase64: toBase64(digest),
    expiresAt: null,
  };
}

async function exportPublicKey(key: CryptoKey): Promise<Uint8Array> {
  const encoded = await crypto.subtle.exportKey("spki", key);
  return new Uint8Array(encoded);
}

async function signSignedPrekey(
  identityPrivateKey: CryptoKey,
  signedPrekeyPublic: Uint8Array,
): Promise<Uint8Array> {
  const signature = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256",
    },
    identityPrivateKey,
    cloneBuffer(signedPrekeyPublic),
  );

  return new Uint8Array(signature);
}

async function computeBundleDigest(input: {
  cryptoSuite: string;
  identityPublicKey: Uint8Array;
  signedPrekeyPublic: Uint8Array;
  signedPrekeyId: string;
  signedPrekeySignature: Uint8Array;
  oneTimePrekeysTotal: number;
  oneTimePrekeysAvailable: number;
}): Promise<Uint8Array> {
  const payload = JSON.stringify({
    cryptoSuite: input.cryptoSuite,
    identityPublicKey: toBase64(input.identityPublicKey),
    signedPrekeyPublic: toBase64(input.signedPrekeyPublic),
    signedPrekeyId: input.signedPrekeyId,
    signedPrekeySignature: toBase64(input.signedPrekeySignature),
    oneTimePrekeysTotal: input.oneTimePrekeysTotal,
    oneTimePrekeysAvailable: input.oneTimePrekeysAvailable,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );

  return new Uint8Array(digest);
}

function createRandomID(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const buffer = new Uint8Array(16);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (value) => value.toString(16).padStart(2, "0")).join("");
}

function buildCryptoDeviceLinkApprovalSigningMessage(
  payload: CryptoDeviceLinkApprovalProof["payload"],
): Uint8Array {
  const lines = [
    "aerochat.crypto_device_link_approval.v1",
    `version=${payload.version}`,
    `link_intent_id=${payload.linkIntentId}`,
    `approver_crypto_device_id=${payload.approverCryptoDeviceId}`,
    `pending_crypto_device_id=${payload.pendingCryptoDeviceId}`,
    `pending_bundle_digest=${payload.pendingBundleDigestBase64}`,
    `approval_challenge=${payload.approvalChallengeBase64}`,
    `challenge_expires_at=${payload.challengeExpiresAt}`,
    `issued_at=${payload.issuedAt}`,
    "",
  ];

  return new TextEncoder().encode(lines.join("\n"));
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return btoa(binary);
}

function cloneBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
