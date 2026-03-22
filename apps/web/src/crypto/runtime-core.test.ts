import { describe, expect, it, vi } from "vitest";
import type {
  CryptoDevice,
  CryptoDeviceBundle,
  CryptoDeviceBundlePayload,
  CryptoDeviceLinkIntent,
  GatewayClient,
} from "../gateway/types";
import { createCryptoRuntimeCore } from "./runtime-core";
import type { CryptoKeyStore } from "./keystore";
import type { CryptoMaterialFactory } from "./material";
import type {
  CryptoRuntimeSession,
  LocalCryptoDeviceMaterial,
  LocalCryptoDeviceRecord,
} from "./types";

const baseSession: CryptoRuntimeSession = {
  token: "token-1",
  profileId: "user-1",
  login: "alice",
};

describe("createCryptoRuntimeCore", () => {
  it("registers first local crypto device when registry is empty", async () => {
    const keyStore = createMemoryKeyStore();
    let registered = false;
    const firstDevice = createCryptoDevice({
      id: "crypto-1",
      status: "active",
      lastBundleVersion: 1,
      lastBundlePublishedAt: "2026-03-22T12:00:00Z",
    });
    const firstBundle = createCryptoDeviceBundle({
      cryptoDeviceId: "crypto-1",
      bundleVersion: 1,
      bundleDigestBase64: "digest-1",
      publishedAt: "2026-03-22T12:00:00Z",
    });
    const gatewayClient = createGatewayClient({
      listCryptoDevices: vi.fn(async () => (registered ? [firstDevice] : [])),
      listCryptoDeviceLinkIntents: vi.fn(async () => []),
      registerFirstCryptoDevice: vi.fn(async () => {
        registered = true;
        return {
          device: firstDevice,
          currentBundle: firstBundle,
        };
      }),
      getCryptoDevice: vi.fn(async () => ({
        device: firstDevice,
        currentBundle: firstBundle,
      })),
    });
    const runtime = createCryptoRuntimeCore({
      gatewayClient,
      keyStore,
      materialFactory: createFakeMaterialFactory(),
      resolveDeviceLabel: () => "Web Test",
    });

    const snapshot = await runtime.bootstrapSession(baseSession);

    expect(snapshot.phase).toBe("ready");
    expect(snapshot.localDevice?.cryptoDeviceId).toBe("crypto-1");
    expect(snapshot.localDevice?.status).toBe("active");
    expect(snapshot.notice).toContain("Создан первый локальный crypto-device");
    expect(gatewayClient.registerFirstCryptoDevice).toHaveBeenCalledTimes(1);
    expect(await keyStore.load(baseSession.profileId)).not.toBeNull();
  });

  it("reuses existing local crypto device and republishes diverged bundle", async () => {
    const keyStore = createMemoryKeyStore();
    await keyStore.save(
      createLocalMaterial({
        cryptoDeviceId: "crypto-1",
        status: "active",
        bundleDigestBase64: "local-digest",
        lastBundleVersion: 1,
      }),
    );
    const device = createCryptoDevice({
      id: "crypto-1",
      status: "active",
      lastBundleVersion: 1,
      lastBundlePublishedAt: "2026-03-22T12:00:00Z",
    });
    const remoteBundle = createCryptoDeviceBundle({
      cryptoDeviceId: "crypto-1",
      bundleVersion: 1,
      bundleDigestBase64: "remote-digest",
      publishedAt: "2026-03-22T12:00:00Z",
    });
    const publishedBundle = createCryptoDeviceBundle({
      cryptoDeviceId: "crypto-1",
      bundleVersion: 2,
      bundleDigestBase64: "local-digest",
      publishedAt: "2026-03-22T12:05:00Z",
    });
    const gatewayClient = createGatewayClient({
      listCryptoDevices: vi.fn(async () => [device]),
      listCryptoDeviceLinkIntents: vi.fn(async () => []),
      getCryptoDevice: vi.fn(async () => ({
        device,
        currentBundle: remoteBundle,
      })),
      publishCryptoDeviceBundle: vi.fn(async () => ({
        device: {
          ...device,
          lastBundleVersion: 2,
          lastBundlePublishedAt: "2026-03-22T12:05:00Z",
        },
        currentBundle: publishedBundle,
      })),
    });
    const runtime = createCryptoRuntimeCore({
      gatewayClient,
      keyStore,
      materialFactory: createFakeMaterialFactory(),
      resolveDeviceLabel: () => "Web Test",
    });

    const snapshot = await runtime.bootstrapSession(baseSession);
    const stored = await keyStore.load(baseSession.profileId);

    expect(snapshot.phase).toBe("ready");
    expect(snapshot.localDevice?.cryptoDeviceId).toBe("crypto-1");
    expect(snapshot.notice).toContain("заново опубликован");
    expect(gatewayClient.publishCryptoDeviceBundle).toHaveBeenCalledTimes(1);
    expect(stored?.record.lastBundleVersion).toBe(2);
    expect(stored?.record.bundleDigestBase64).toBe("local-digest");
  });

  it("creates pending linked device and link intent for a new browser profile", async () => {
    const keyStore = createMemoryKeyStore();
    let pendingRegistered = false;
    const activeDevice = createCryptoDevice({
      id: "crypto-active",
      status: "active",
      lastBundleVersion: 2,
      lastBundlePublishedAt: "2026-03-22T11:00:00Z",
    });
    const pendingDevice = createCryptoDevice({
      id: "crypto-pending",
      status: "pending_link",
      lastBundleVersion: 1,
      lastBundlePublishedAt: "2026-03-22T12:00:00Z",
    });
    const pendingBundle = createCryptoDeviceBundle({
      cryptoDeviceId: "crypto-pending",
      bundleVersion: 1,
      bundleDigestBase64: "digest-1",
      publishedAt: "2026-03-22T12:00:00Z",
    });
    const pendingIntent = createCryptoDeviceLinkIntent({
      id: "intent-1",
      pendingCryptoDeviceId: "crypto-pending",
      status: "pending",
    });
    const gatewayClient = createGatewayClient({
      listCryptoDevices: vi.fn(async () =>
        pendingRegistered ? [activeDevice, pendingDevice] : [activeDevice],
      ),
      listCryptoDeviceLinkIntents: vi.fn(async () =>
        pendingRegistered ? [pendingIntent] : [],
      ),
      registerPendingLinkedCryptoDevice: vi.fn(async () => {
        pendingRegistered = true;
        return {
          device: pendingDevice,
          currentBundle: pendingBundle,
        };
      }),
      createCryptoDeviceLinkIntent: vi.fn(async () => pendingIntent),
      getCryptoDevice: vi.fn(async () => ({
        device: pendingDevice,
        currentBundle: pendingBundle,
      })),
    });
    const runtime = createCryptoRuntimeCore({
      gatewayClient,
      keyStore,
      materialFactory: createFakeMaterialFactory(),
      resolveDeviceLabel: () => "Web Test",
    });

    const snapshot = await runtime.createPendingLinkedDevice(baseSession);

    expect(snapshot.phase).toBe("ready");
    expect(snapshot.localDevice?.cryptoDeviceId).toBe("crypto-pending");
    expect(snapshot.localDevice?.status).toBe("pending_link");
    expect(snapshot.localDevice?.linkIntentId).toBe("intent-1");
    expect(snapshot.notice).toContain("pending crypto-device создан");
    expect(gatewayClient.registerPendingLinkedCryptoDevice).toHaveBeenCalledTimes(1);
    expect(gatewayClient.createCryptoDeviceLinkIntent).toHaveBeenCalledWith(
      baseSession.token,
      "crypto-pending",
    );
  });

  it("approves pending link intent from existing active local device", async () => {
    const keyStore = createMemoryKeyStore();
    await keyStore.save(
      createLocalMaterial({
        cryptoDeviceId: "crypto-1",
        status: "active",
        bundleDigestBase64: "digest-1",
        lastBundleVersion: 1,
        linkIntentId: null,
      }),
    );
    const activeDevice = createCryptoDevice({
      id: "crypto-1",
      status: "active",
      lastBundleVersion: 1,
      lastBundlePublishedAt: "2026-03-22T12:00:00Z",
    });
    const bundle = createCryptoDeviceBundle({
      cryptoDeviceId: "crypto-1",
      bundleVersion: 1,
      bundleDigestBase64: "digest-1",
      publishedAt: "2026-03-22T12:00:00Z",
    });
    const pendingIntent = createCryptoDeviceLinkIntent({
      id: "intent-1",
      pendingCryptoDeviceId: "crypto-pending",
      status: "pending",
    });
    const gatewayClient = createGatewayClient({
      listCryptoDevices: vi.fn(async () => [activeDevice]),
      listCryptoDeviceLinkIntents: vi.fn(async () => [pendingIntent]),
      getCryptoDevice: vi.fn(async () => ({
        device: activeDevice,
        currentBundle: bundle,
      })),
      approveCryptoDeviceLinkIntent: vi.fn(async () => ({
        linkIntent: {
          ...pendingIntent,
          status: "approved" as const,
          approvedAt: "2026-03-22T12:05:00Z",
        },
        device: activeDevice,
      })),
    });
    const runtime = createCryptoRuntimeCore({
      gatewayClient,
      keyStore,
      materialFactory: createFakeMaterialFactory(),
      resolveDeviceLabel: () => "Web Test",
    });

    const snapshot = await runtime.approveLinkIntent(baseSession, "intent-1");

    expect(snapshot.phase).toBe("ready");
    expect(snapshot.notice).toContain("одобрен");
    expect(gatewayClient.approveCryptoDeviceLinkIntent).toHaveBeenCalledWith(
      baseSession.token,
      "intent-1",
      "crypto-1",
      {
        payload: {
          version: 1,
          linkIntentId: "intent-1",
          approverCryptoDeviceId: "crypto-1",
          pendingCryptoDeviceId: "crypto-pending",
          pendingBundleDigestBase64: "digest-1",
          approvalChallengeBase64: "challenge-1",
          challengeExpiresAt: "2026-03-22T13:00:00Z",
          issuedAt: expect.any(String),
        },
        signatureBase64: "approval-signature",
      },
    );
  });
});

function createMemoryKeyStore(): CryptoKeyStore {
  const records = new Map<string, LocalCryptoDeviceMaterial>();

  return {
    isSupported() {
      return true;
    },
    async load(accountId) {
      return records.get(accountId) ?? null;
    },
    async save(material) {
      records.set(material.record.accountId, material);
    },
    async delete(accountId) {
      records.delete(accountId);
    },
  };
}

function createFakeMaterialFactory(): CryptoMaterialFactory {
  return {
    isSupported() {
      return true;
    },
    async createDeviceMaterial(input) {
      const material = createLocalMaterial({
        cryptoDeviceId: input.deviceId,
        status: input.status,
        bundleDigestBase64: "digest-1",
        lastBundleVersion: input.bundleVersion,
        lastBundlePublishedAt: input.publishedAt,
        linkIntentId: input.linkIntentId,
        linkIntentExpiresAt: input.linkIntentExpiresAt,
        accountId: input.accountId,
        login: input.login,
        deviceLabel: input.deviceLabel,
      });

      return {
        material,
        bundle: createBundlePayload("digest-1", material.record.signedPrekeyId),
      };
    },
    async buildBundle(material) {
      return createBundlePayload(
        material.record.bundleDigestBase64,
        material.record.signedPrekeyId,
      );
    },
    async buildLinkApprovalProof(_material, input) {
      return {
        payload: {
          version: 1,
          linkIntentId: input.linkIntentId,
          approverCryptoDeviceId: input.approverCryptoDeviceId,
          pendingCryptoDeviceId: input.pendingCryptoDeviceId,
          pendingBundleDigestBase64: input.pendingBundleDigestBase64,
          approvalChallengeBase64: input.approvalChallengeBase64,
          challengeExpiresAt: input.challengeExpiresAt,
          issuedAt: input.issuedAt,
        },
        signatureBase64: "approval-signature",
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
        },
      };
    },
  };
}

function createBundlePayload(
  digest: string,
  signedPrekeyId: string,
): CryptoDeviceBundlePayload {
  return {
    cryptoSuite: "webcrypto-p256-foundation-v1",
    identityPublicKeyBase64: "identity-public",
    signedPrekeyPublicBase64: "signed-prekey-public",
    signedPrekeyId,
    signedPrekeySignatureBase64: "signature",
    kemPublicKeyBase64: null,
    kemKeyId: null,
    kemSignatureBase64: null,
    oneTimePrekeysTotal: 0,
    oneTimePrekeysAvailable: 0,
    bundleDigestBase64: digest,
    expiresAt: null,
  };
}

function createLocalMaterial(
  overrides: Partial<LocalCryptoDeviceRecord> & {
    cryptoDeviceId: string;
    status: "active" | "pending_link" | "revoked";
    bundleDigestBase64: string;
    lastBundleVersion: number;
  },
): LocalCryptoDeviceMaterial {
  const record: LocalCryptoDeviceRecord = {
    version: 1,
    accountId: overrides.accountId ?? baseSession.profileId,
    login: overrides.login ?? baseSession.login,
    cryptoDeviceId: overrides.cryptoDeviceId,
    deviceLabel: overrides.deviceLabel ?? "Web Test",
    cryptoSuite: "webcrypto-p256-foundation-v1",
    status: overrides.status,
    signedPrekeyId: overrides.signedPrekeyId ?? "signed-prekey-1",
    bundleDigestBase64: overrides.bundleDigestBase64,
    lastBundleVersion: overrides.lastBundleVersion,
    lastBundlePublishedAt: overrides.lastBundlePublishedAt ?? null,
    createdAt: "2026-03-22T12:00:00Z",
    updatedAt: "2026-03-22T12:00:00Z",
    linkIntentId: overrides.linkIntentId ?? null,
    linkIntentExpiresAt: overrides.linkIntentExpiresAt ?? null,
  };

  return {
    record,
    identityPublicKey: {} as CryptoKey,
    identityPrivateKey: {} as CryptoKey,
    signedPrekeyPublicKey: {} as CryptoKey,
    signedPrekeyPrivateKey: {} as CryptoKey,
  };
}

function createCryptoDevice(overrides: Partial<CryptoDevice> & { id: string }): CryptoDevice {
  return {
    id: overrides.id,
    userId: overrides.userId ?? baseSession.profileId,
    label: overrides.label ?? "Web Test",
    status: overrides.status ?? "active",
    linkedByCryptoDeviceId: overrides.linkedByCryptoDeviceId ?? null,
    lastBundleVersion: overrides.lastBundleVersion ?? 1,
    lastBundlePublishedAt: overrides.lastBundlePublishedAt ?? null,
    createdAt: overrides.createdAt ?? "2026-03-22T12:00:00Z",
    activatedAt: overrides.activatedAt ?? "2026-03-22T12:00:00Z",
    revokedAt: overrides.revokedAt ?? null,
    revocationReason: overrides.revocationReason ?? null,
    revokedByActor: overrides.revokedByActor ?? null,
  };
}

function createCryptoDeviceBundle(
  overrides: Partial<CryptoDeviceBundle> & {
    cryptoDeviceId: string;
    bundleVersion: number;
    bundleDigestBase64: string;
    publishedAt: string;
  },
): CryptoDeviceBundle {
  return {
    cryptoDeviceId: overrides.cryptoDeviceId,
    bundleVersion: overrides.bundleVersion,
    cryptoSuite: overrides.cryptoSuite ?? "webcrypto-p256-foundation-v1",
    identityPublicKeyBase64: overrides.identityPublicKeyBase64 ?? "identity-public",
    signedPrekeyPublicBase64: overrides.signedPrekeyPublicBase64 ?? "signed-prekey-public",
    signedPrekeyId: overrides.signedPrekeyId ?? "signed-prekey-1",
    signedPrekeySignatureBase64: overrides.signedPrekeySignatureBase64 ?? "signature",
    kemPublicKeyBase64: overrides.kemPublicKeyBase64 ?? null,
    kemKeyId: overrides.kemKeyId ?? null,
    kemSignatureBase64: overrides.kemSignatureBase64 ?? null,
    oneTimePrekeysTotal: overrides.oneTimePrekeysTotal ?? 0,
    oneTimePrekeysAvailable: overrides.oneTimePrekeysAvailable ?? 0,
    bundleDigestBase64: overrides.bundleDigestBase64,
    publishedAt: overrides.publishedAt,
    expiresAt: overrides.expiresAt ?? null,
    supersededAt: overrides.supersededAt ?? null,
  };
}

function createCryptoDeviceLinkIntent(
  overrides: Partial<CryptoDeviceLinkIntent> & {
    id: string;
    pendingCryptoDeviceId: string;
    status: "pending" | "approved" | "expired";
  },
): CryptoDeviceLinkIntent {
  return {
    id: overrides.id,
    userId: overrides.userId ?? baseSession.profileId,
    pendingCryptoDeviceId: overrides.pendingCryptoDeviceId,
    status: overrides.status,
    bundleDigestBase64: overrides.bundleDigestBase64 ?? "digest-1",
    approvalChallengeBase64: overrides.approvalChallengeBase64 ?? "challenge-1",
    createdAt: overrides.createdAt ?? "2026-03-22T12:00:00Z",
    expiresAt: overrides.expiresAt ?? "2026-03-22T13:00:00Z",
    approvedAt: overrides.approvedAt ?? null,
    expiredAt: overrides.expiredAt ?? null,
    approverCryptoDeviceId: overrides.approverCryptoDeviceId ?? null,
  };
}

function createGatewayClient(overrides: Partial<GatewayClient>): GatewayClient {
  return {
    register: vi.fn(),
    login: vi.fn(),
    logoutCurrentSession: vi.fn(),
    getCurrentProfile: vi.fn(),
    registerFirstCryptoDevice: vi.fn(),
    registerPendingLinkedCryptoDevice: vi.fn(),
    listCryptoDevices: vi.fn(),
    getCryptoDevice: vi.fn(),
    publishCryptoDeviceBundle: vi.fn(),
    createCryptoDeviceLinkIntent: vi.fn(),
    listCryptoDeviceLinkIntents: vi.fn(),
    approveCryptoDeviceLinkIntent: vi.fn(),
    listDevices: vi.fn(),
    revokeSessionOrDevice: vi.fn(),
    createGroup: vi.fn(),
    listGroups: vi.fn(),
    getGroup: vi.fn(),
    getGroupChat: vi.fn(),
    markGroupChatRead: vi.fn(),
    createAttachmentUploadIntent: vi.fn(),
    completeAttachmentUpload: vi.fn(),
    getAttachment: vi.fn(),
    setGroupTyping: vi.fn(),
    clearGroupTyping: vi.fn(),
    listGroupMembers: vi.fn(),
    updateGroupMemberRole: vi.fn(),
    restrictGroupMember: vi.fn(),
    unrestrictGroupMember: vi.fn(),
    transferGroupOwnership: vi.fn(),
    removeGroupMember: vi.fn(),
    leaveGroup: vi.fn(),
    createGroupInviteLink: vi.fn(),
    listGroupInviteLinks: vi.fn(),
    disableGroupInviteLink: vi.fn(),
    joinGroupByInviteLink: vi.fn(),
    listGroupMessages: vi.fn(),
    sendGroupTextMessage: vi.fn(),
    editGroupMessage: vi.fn(),
    createDirectChat: vi.fn(),
    listDirectChats: vi.fn(),
    getDirectChat: vi.fn(),
    markDirectChatRead: vi.fn(),
    setDirectChatTyping: vi.fn(),
    clearDirectChatTyping: vi.fn(),
    setDirectChatPresenceHeartbeat: vi.fn(),
    clearDirectChatPresence: vi.fn(),
    sendTextMessage: vi.fn(),
    editDirectChatMessage: vi.fn(),
    listDirectChatMessages: vi.fn(),
    searchMessages: vi.fn(),
    deleteMessageForEveryone: vi.fn(),
    pinMessage: vi.fn(),
    unpinMessage: vi.fn(),
    sendFriendRequest: vi.fn(),
    acceptFriendRequest: vi.fn(),
    declineFriendRequest: vi.fn(),
    cancelOutgoingFriendRequest: vi.fn(),
    listIncomingFriendRequests: vi.fn(),
    listOutgoingFriendRequests: vi.fn(),
    listFriends: vi.fn(),
    removeFriend: vi.fn(),
    updateCurrentProfile: vi.fn(),
    ...overrides,
  };
}
