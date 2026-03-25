import { describe, expect, it, vi } from "vitest";
import type {
  CryptoDevice,
  CryptoDeviceBundle,
  CryptoDeviceBundlePublishChallenge,
  CryptoDeviceBundlePayload,
  CryptoDeviceLinkIntent,
  EncryptedGroupEnvelope,
  GatewayClient,
} from "../gateway/types";
import { createCryptoRuntimeCore } from "./runtime-core";
import type { CryptoKeyStore } from "./keystore";
import {
  createWebCryptoMaterialFactory,
  type CryptoMaterialFactory,
} from "./material";
import { encryptEncryptedGroupPayloadForTest } from "./encrypted-group-codec";
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
      createCryptoDeviceBundlePublishChallenge: vi.fn(async () =>
        createBundlePublishChallenge({
          cryptoDeviceId: "crypto-1",
          currentBundleVersion: 1,
          currentBundleDigestBase64: "remote-digest",
        }),
      ),
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
    expect(gatewayClient.createCryptoDeviceBundlePublishChallenge).toHaveBeenCalledWith(
      baseSession.token,
      "crypto-1",
    );
    expect(gatewayClient.publishCryptoDeviceBundle).toHaveBeenCalledTimes(1);
    expect(gatewayClient.publishCryptoDeviceBundle).toHaveBeenCalledWith(
      baseSession.token,
      "crypto-1",
      expect.objectContaining({
        bundleDigestBase64: "local-digest",
      }),
      {
        payload: {
          version: 1,
          cryptoDeviceId: "crypto-1",
          previousBundleVersion: 1,
          previousBundleDigestBase64: "remote-digest",
          newBundleDigestBase64: "local-digest",
          publishChallengeBase64: "publish-challenge-1",
          challengeExpiresAt: "2026-03-22T13:00:00Z",
          issuedAt: expect.any(String),
        },
        signatureBase64: "publish-signature",
      },
    );
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

  it("assembles and sends encrypted dm v2 content inside runtime boundary", async () => {
    const keyStore = createMemoryKeyStore();
    await keyStore.save(
      createLocalMaterial({
        cryptoDeviceId: "crypto-1",
        status: "active",
        bundleDigestBase64: "digest-1",
        lastBundleVersion: 1,
      }),
    );
    const signedPrekeyPublicBase64 = await createSignedPrekeyPublicBase64();
    const gatewayClient = createGatewayClient({
      getEncryptedDirectMessageV2SendBootstrap: vi.fn(async () => ({
        chatId: "chat-1",
        recipientUserId: "user-2",
        recipientDevices: [
          {
            userId: "user-2",
            cryptoDeviceId: "peer-device-1",
            bundleVersion: 3,
            cryptoSuite: "webcrypto-p256-foundation-v1",
            identityPublicKeyBase64: "peer-identity-public",
            signedPrekeyPublicBase64,
            signedPrekeyId: "peer-signed-prekey-1",
            signedPrekeySignatureBase64: "peer-signature",
            kemPublicKeyBase64: null,
            kemKeyId: null,
            kemSignatureBase64: null,
            oneTimePrekeysTotal: 0,
            oneTimePrekeysAvailable: 0,
            bundleDigestBase64: "peer-digest-1",
            publishedAt: "2026-03-22T12:10:00Z",
            expiresAt: null,
          },
        ],
        senderOtherDevices: [],
      })),
      sendEncryptedDirectMessageV2: vi.fn(async (token, input) => ({
        messageId: input.messageId,
        chatId: input.chatId,
        senderUserId: baseSession.profileId,
        senderCryptoDeviceId: input.senderCryptoDeviceId,
        operationKind: "ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_CONTENT",
        targetMessageId: null,
        revision: input.revision,
        createdAt: "2026-03-22T12:11:00Z",
        storedAt: "2026-03-22T12:11:01Z",
        storedDeliveryCount: input.deliveries.length,
        storedDeliveries: input.deliveries.map((delivery: (typeof input.deliveries)[number]) => ({
          recipientUserId:
            delivery.recipientUserId ?? baseSession.profileId,
          recipientCryptoDeviceId: delivery.recipientCryptoDeviceId,
          storedAt: "2026-03-22T12:11:01Z",
          unreadState: null,
        })),
      })),
    });
    const runtime = createCryptoRuntimeCore({
      gatewayClient,
      keyStore,
      materialFactory: createFakeMaterialFactory(),
      resolveDeviceLabel: () => "Web Test",
    });

    const result = await runtime.sendEncryptedDirectMessageV2Content(baseSession, {
      chatId: "chat-1",
      text: "secret hello",
      attachmentDrafts: [],
    });

    expect(gatewayClient.getEncryptedDirectMessageV2SendBootstrap).toHaveBeenCalledWith(
      baseSession.token,
      "chat-1",
      "crypto-1",
    );
    expect(gatewayClient.sendEncryptedDirectMessageV2).toHaveBeenCalledTimes(1);
    expect(gatewayClient.sendEncryptedDirectMessageV2).toHaveBeenCalledWith(
      baseSession.token,
      expect.objectContaining({
        chatId: "chat-1",
        messageCreatedAt: expect.any(String),
        senderCryptoDeviceId: "crypto-1",
        operationKind: "content",
        revision: 1,
        attachmentIds: [],
        deliveries: expect.arrayContaining([
          expect.objectContaining({
            recipientCryptoDeviceId: "crypto-1",
            transportHeader: expect.any(String),
            ciphertext: expect.any(String),
          }),
          expect.objectContaining({
            recipientCryptoDeviceId: "peer-device-1",
            transportHeader: expect.any(String),
            ciphertext: expect.any(String),
          }),
        ]),
      }),
    );
    expect(result.localProjection.text).toBe("secret hello");
    expect(result.localProjection.attachments).toEqual([]);
    expect(result.localProjection.chatId).toBe("chat-1");
    expect(result.localProjection.replyToMessageId).toBeNull();
    expect(result.storedEnvelope.storedDeliveryCount).toBe(2);
  });

  it("assembles and sends encrypted group content inside runtime boundary", async () => {
    const keyStore = createMemoryKeyStore();
    await keyStore.save(
      createLocalMaterial({
        cryptoDeviceId: "crypto-1",
        status: "active",
        bundleDigestBase64: "digest-1",
        lastBundleVersion: 1,
      }),
    );
    const localSignedPrekeyPublicBase64 = await createSignedPrekeyPublicBase64();
    const peerSignedPrekeyPublicBase64 = await createSignedPrekeyPublicBase64();
    const gatewayClient = createGatewayClient({
      getEncryptedGroupBootstrap: vi.fn(async () => ({
        lane: {
          groupId: "group-1",
          threadId: "thread-1",
          mlsGroupId: "mls-1",
          rosterVersion: 7,
          activatedAt: "2026-03-22T12:00:00Z",
          updatedAt: "2026-03-22T12:05:00Z",
        },
        rosterMembers: [],
        rosterDevices: [
          {
            userId: baseSession.profileId,
            cryptoDeviceId: "crypto-1",
            bundleVersion: 1,
            cryptoSuite: "webcrypto-p256-foundation-v1",
            identityPublicKeyBase64: "self-identity-public",
            signedPrekeyPublicBase64: localSignedPrekeyPublicBase64,
            signedPrekeyId: "self-signed-prekey-1",
            signedPrekeySignatureBase64: "self-signature",
            kemPublicKeyBase64: null,
            kemKeyId: null,
            kemSignatureBase64: null,
            oneTimePrekeysTotal: 0,
            oneTimePrekeysAvailable: 0,
            bundleDigestBase64: "self-digest-1",
            publishedAt: "2026-03-22T12:10:00Z",
            expiresAt: null,
            updatedAt: "2026-03-22T12:10:00Z",
          },
          {
            userId: "user-2",
            cryptoDeviceId: "peer-device-1",
            bundleVersion: 3,
            cryptoSuite: "webcrypto-p256-foundation-v1",
            identityPublicKeyBase64: "peer-identity-public",
            signedPrekeyPublicBase64: peerSignedPrekeyPublicBase64,
            signedPrekeyId: "peer-signed-prekey-1",
            signedPrekeySignatureBase64: "peer-signature",
            kemPublicKeyBase64: null,
            kemKeyId: null,
            kemSignatureBase64: null,
            oneTimePrekeysTotal: 0,
            oneTimePrekeysAvailable: 0,
            bundleDigestBase64: "peer-digest-1",
            publishedAt: "2026-03-22T12:10:00Z",
            expiresAt: null,
            updatedAt: "2026-03-22T12:10:00Z",
          },
        ],
      })),
      sendEncryptedGroupMessage: vi.fn(async (_token, input) => ({
        messageId: input.messageId,
        groupId: input.groupId,
        threadId: "thread-1",
        mlsGroupId: input.mlsGroupId,
        rosterVersion: input.rosterVersion,
        senderUserId: baseSession.profileId,
        senderCryptoDeviceId: input.senderCryptoDeviceId,
        operationKind: "ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_CONTENT",
        targetMessageId: null,
        revision: input.revision,
        createdAt: "2026-03-22T12:11:00Z",
        storedAt: "2026-03-22T12:11:01Z",
        storedDeliveryCount: 2,
        storedDeliveries: [
          {
            recipientUserId: baseSession.profileId,
            recipientCryptoDeviceId: "crypto-1",
            storedAt: "2026-03-22T12:11:01Z",
            unreadState: null,
          },
          {
            recipientUserId: "user-2",
            recipientCryptoDeviceId: "peer-device-1",
            storedAt: "2026-03-22T12:11:01Z",
            unreadState: null,
          },
        ],
      })),
    });
    const runtime = createCryptoRuntimeCore({
      gatewayClient,
      keyStore,
      materialFactory: createFakeMaterialFactory(),
      resolveDeviceLabel: () => "Web Test",
    });

    const result = await runtime.sendEncryptedGroupContent(baseSession, {
      groupId: "group-1",
      text: "secret group hello",
    });

    expect(gatewayClient.getEncryptedGroupBootstrap).toHaveBeenCalledWith(
      baseSession.token,
      "group-1",
      "crypto-1",
    );
    expect(gatewayClient.sendEncryptedGroupMessage).toHaveBeenCalledTimes(1);
    expect(gatewayClient.sendEncryptedGroupMessage).toHaveBeenCalledWith(
      baseSession.token,
      expect.objectContaining({
        groupId: "group-1",
        messageCreatedAt: expect.any(String),
        mlsGroupId: "mls-1",
        rosterVersion: 7,
        senderCryptoDeviceId: "crypto-1",
        operationKind: "content",
        revision: 1,
        attachmentIds: [],
        ciphertext: expect.any(String),
      }),
    );
    expect(result.localProjection.text).toBe("secret group hello");
    expect(result.localProjection.attachments).toEqual([]);
    expect(result.localProjection.groupId).toBe("group-1");
    expect(result.localProjection.threadId).toBe("thread-1");
    expect(result.localProjection.replyToMessageId).toBeNull();
    expect(result.storedEnvelope.storedDeliveryCount).toBe(2);
  });

  it("reuses encrypted media relay drafts for encrypted group content", async () => {
    const keyStore = createMemoryKeyStore();
    await keyStore.save(
      createLocalMaterial({
        cryptoDeviceId: "crypto-1",
        status: "active",
        bundleDigestBase64: "digest-1",
        lastBundleVersion: 1,
      }),
    );
    const peerSignedPrekeyPublicBase64 = await createSignedPrekeyPublicBase64();
    const gatewayClient = createGatewayClient({
      getEncryptedGroupBootstrap: vi.fn(async () => ({
        lane: {
          groupId: "group-1",
          threadId: "thread-1",
          mlsGroupId: "mls-1",
          rosterVersion: 7,
          activatedAt: "2026-03-22T12:10:00Z",
          updatedAt: "2026-03-22T12:10:00Z",
        },
        rosterMembers: [],
        rosterDevices: [
          {
            userId: baseSession.profileId,
            cryptoDeviceId: "crypto-1",
            bundleVersion: 2,
            cryptoSuite: "webcrypto-p256-foundation-v1",
            identityPublicKeyBase64: "self-identity-public",
            signedPrekeyPublicBase64: await createSignedPrekeyPublicBase64(),
            signedPrekeyId: "self-signed-prekey-1",
            signedPrekeySignatureBase64: "self-signature",
            kemPublicKeyBase64: null,
            kemKeyId: null,
            kemSignatureBase64: null,
            oneTimePrekeysTotal: 0,
            oneTimePrekeysAvailable: 0,
            bundleDigestBase64: "self-digest-1",
            publishedAt: "2026-03-22T12:10:00Z",
            expiresAt: null,
            updatedAt: "2026-03-22T12:10:00Z",
          },
          {
            userId: "user-2",
            cryptoDeviceId: "peer-device-1",
            bundleVersion: 3,
            cryptoSuite: "webcrypto-p256-foundation-v1",
            identityPublicKeyBase64: "peer-identity-public",
            signedPrekeyPublicBase64: peerSignedPrekeyPublicBase64,
            signedPrekeyId: "peer-signed-prekey-1",
            signedPrekeySignatureBase64: "peer-signature",
            kemPublicKeyBase64: null,
            kemKeyId: null,
            kemSignatureBase64: null,
            oneTimePrekeysTotal: 0,
            oneTimePrekeysAvailable: 0,
            bundleDigestBase64: "peer-digest-1",
            publishedAt: "2026-03-22T12:10:00Z",
            expiresAt: null,
            updatedAt: "2026-03-22T12:10:00Z",
          },
        ],
      })),
      sendEncryptedGroupMessage: vi.fn(async (_token, input) => ({
        messageId: input.messageId,
        groupId: input.groupId,
        threadId: "thread-1",
        mlsGroupId: input.mlsGroupId,
        rosterVersion: input.rosterVersion,
        senderUserId: baseSession.profileId,
        senderCryptoDeviceId: input.senderCryptoDeviceId,
        operationKind: "ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_CONTENT",
        targetMessageId: null,
        revision: input.revision,
        createdAt: "2026-03-22T12:11:00Z",
        storedAt: "2026-03-22T12:11:01Z",
        storedDeliveryCount: 2,
        storedDeliveries: [],
      })),
    });
    const runtime = createCryptoRuntimeCore({
      gatewayClient,
      keyStore,
      materialFactory: createFakeMaterialFactory(),
      resolveDeviceLabel: () => "Web Test",
    });

    const prepared = await runtime.prepareEncryptedMediaRelayUpload(baseSession, {
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      fileBytes: new TextEncoder().encode("hello").buffer,
    });
    const result = await runtime.sendEncryptedGroupContent(baseSession, {
      groupId: "group-1",
      text: "",
      attachmentDrafts: [
        {
          draftId: prepared.draftId,
          attachmentId: "attachment-1",
        },
      ],
    });

    expect(gatewayClient.sendEncryptedGroupMessage).toHaveBeenCalledWith(
      baseSession.token,
      expect.objectContaining({
        groupId: "group-1",
        messageCreatedAt: expect.any(String),
        operationKind: "content",
        attachmentIds: ["attachment-1"],
      }),
    );
    expect(result.localProjection.text).toBeNull();
    expect(result.localProjection.attachments).toHaveLength(1);
    expect(result.localProjection.attachments?.[0]).toEqual(
      expect.objectContaining({
        attachmentId: "attachment-1",
        relaySchema: "ATTACHMENT_RELAY_SCHEMA_ENCRYPTED_BLOB_V1",
        fileName: "photo.jpg",
        mimeType: "image/jpeg",
        plaintextSizeBytes: 5,
      }),
    );
  });

  it("decrypts encrypted group envelopes inside runtime boundary", async () => {
    const keyStore = createMemoryKeyStore();
    const localFactory = createWebCryptoMaterialFactory();
    const { material: localMaterial } = await localFactory.createDeviceMaterial({
      accountId: baseSession.profileId,
      login: baseSession.login,
      deviceLabel: "Web Test",
      deviceId: "crypto-2",
      status: "active",
      bundleVersion: 1,
      publishedAt: null,
      linkIntentId: null,
      linkIntentExpiresAt: null,
    });
    await keyStore.save(localMaterial);
    const envelope = createEncryptedGroupEnvelope();
    const encrypted = await encryptEncryptedGroupPayloadForTest({
      recipientDevices: [
        {
          cryptoDeviceId: "crypto-2",
          signedPrekeyPublicKey: localMaterial.signedPrekeyPublicKey,
        },
      ],
      envelope,
      payload: {
        schema: "aerochat.web.encrypted_group_message_v1.payload.v1",
        operation: "content",
        replyToMessageId: null,
        message: {
          text: "encrypted group hello",
          markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
          attachments: [],
        },
      },
    });
    const runtime = createCryptoRuntimeCore({
      gatewayClient: createGatewayClient({}),
      keyStore,
      materialFactory: createFakeMaterialFactory(),
      resolveDeviceLabel: () => "Web Test",
    });

    const result = await runtime.decryptEncryptedGroupEnvelopes(baseSession, [
      {
        ...envelope,
        ...encrypted,
      },
    ]);

    expect(result).toEqual([
      {
        status: "ready",
        messageId: "message-1",
        groupId: "group-1",
        threadId: "thread-1",
        mlsGroupId: "mls-1",
        rosterVersion: 5,
        senderUserId: "user-1",
        senderCryptoDeviceId: "crypto-1",
        operationKind: "content",
        targetMessageId: null,
        revision: 1,
        createdAt: "2026-03-22T12:00:00Z",
        storedAt: "2026-03-22T12:00:01Z",
        payloadSchema: "aerochat.web.encrypted_group_message_v1.payload.v1",
        replyToMessageId: null,
        text: "encrypted group hello",
        markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
        attachments: [],
        editedAt: null,
        deletedAt: null,
      },
    ]);
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
      const signedPrekeyPublicBase64 = await createSignedPrekeyPublicBase64();

      return {
        material,
        bundle: createBundlePayload(
          "digest-1",
          material.record.signedPrekeyId,
          signedPrekeyPublicBase64,
        ),
      };
    },
    async buildBundle(material) {
      const signedPrekeyPublicBase64 = await createSignedPrekeyPublicBase64();
      return createBundlePayload(
        material.record.bundleDigestBase64,
        material.record.signedPrekeyId,
        signedPrekeyPublicBase64,
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
    async buildBundlePublishProof(_material, input) {
      return {
        payload: {
          version: 1,
          cryptoDeviceId: input.cryptoDeviceId,
          previousBundleVersion: input.previousBundleVersion,
          previousBundleDigestBase64: input.previousBundleDigestBase64,
          newBundleDigestBase64: input.newBundleDigestBase64,
          publishChallengeBase64: input.publishChallengeBase64,
          challengeExpiresAt: input.challengeExpiresAt,
          issuedAt: input.issuedAt,
        },
        signatureBase64: "publish-signature",
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
  signedPrekeyPublicBase64: string,
): CryptoDeviceBundlePayload {
  return {
    cryptoSuite: "webcrypto-p256-foundation-v1",
    identityPublicKeyBase64: "identity-public",
    signedPrekeyPublicBase64,
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

function createBundlePublishChallenge(
  overrides: Partial<CryptoDeviceBundlePublishChallenge> & {
    cryptoDeviceId: string;
    currentBundleVersion: number;
    currentBundleDigestBase64: string;
  },
): CryptoDeviceBundlePublishChallenge {
  return {
    cryptoDeviceId: overrides.cryptoDeviceId,
    currentBundleVersion: overrides.currentBundleVersion,
    currentBundleDigestBase64: overrides.currentBundleDigestBase64,
    publishChallengeBase64: overrides.publishChallengeBase64 ?? "publish-challenge-1",
    createdAt: overrides.createdAt ?? "2026-03-22T12:00:00Z",
    expiresAt: overrides.expiresAt ?? "2026-03-22T13:00:00Z",
  };
}

async function createSignedPrekeyPublicBase64(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveKey", "deriveBits"],
  );
  const exported = await crypto.subtle.exportKey("spki", pair.publicKey);
  return toBase64(new Uint8Array(exported));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
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
    createCryptoDeviceBundlePublishChallenge: vi.fn(),
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
    markEncryptedGroupChatRead: vi.fn(),
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
    previewGroupByInviteLink: vi.fn(),
    joinGroupByInviteLink: vi.fn(),
    createDirectChat: vi.fn(),
    listDirectChats: vi.fn(),
    getDirectChat: vi.fn(),
    getActiveCall: vi.fn(),
    startCall: vi.fn(),
    joinCall: vi.fn(),
    leaveCall: vi.fn(),
    endCall: vi.fn(),
    listCallParticipants: vi.fn(),
    sendRtcSignal: vi.fn(),
    markDirectChatRead: vi.fn(),
    markEncryptedDirectChatRead: vi.fn(),
    setDirectChatTyping: vi.fn(),
    clearDirectChatTyping: vi.fn(),
    setDirectChatPresenceHeartbeat: vi.fn(),
    clearDirectChatPresence: vi.fn(),
    getEncryptedDirectMessageV2SendBootstrap: vi.fn(),
    getEncryptedGroupBootstrap: vi.fn(),
    sendEncryptedDirectMessageV2: vi.fn(),
    sendEncryptedGroupMessage: vi.fn(),
    sendTextMessage: vi.fn(),
    editDirectChatMessage: vi.fn(),
    listDirectChatMessages: vi.fn(),
    listEncryptedDirectMessageV2: vi.fn(),
    listEncryptedGroupMessages: vi.fn(),
    searchMessages: vi.fn(),
    deleteMessageForEveryone: vi.fn(),
    pinMessage: vi.fn(),
    unpinMessage: vi.fn(),
    pinEncryptedDirectMessageV2: vi.fn(),
    unpinEncryptedDirectMessageV2: vi.fn(),
    pinEncryptedGroupMessage: vi.fn(),
    unpinEncryptedGroupMessage: vi.fn(),
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

function createEncryptedGroupEnvelope(): EncryptedGroupEnvelope {
  return {
    messageId: "message-1",
    groupId: "group-1",
    threadId: "thread-1",
    mlsGroupId: "mls-1",
    rosterVersion: 5,
    senderUserId: "user-1",
    senderCryptoDeviceId: "crypto-1",
    operationKind: "ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_CONTENT",
    targetMessageId: null,
    revision: 1,
    ciphertext: "",
    ciphertextSizeBytes: 0,
    createdAt: "2026-03-22T12:00:00Z",
    storedAt: "2026-03-22T12:00:01Z",
    viewerDelivery: {
      recipientUserId: "user-1",
      recipientCryptoDeviceId: "crypto-2",
      storedAt: "2026-03-22T12:00:01Z",
      unreadState: null,
    },
  };
}
