import type {
  EncryptedDirectMessageV2Envelope,
  GatewayClient,
} from "../gateway/types";
import {
  describeGatewayError,
  type CryptoDevice,
  type CryptoDeviceBundle,
  type CryptoDeviceLinkIntent,
} from "../gateway/types";
import type { CryptoKeyStore } from "./keystore";
import type { CryptoMaterialFactory } from "./material";
import { decryptEncryptedDirectMessageV2Envelope } from "./encrypted-v2-codec";
import type {
  EncryptedDirectMessageV2DecryptedEnvelope,
  CryptoRuntimeSession,
  CryptoRuntimeSnapshot,
  LocalCryptoDeviceMaterial,
} from "./types";

interface RuntimeDependencies {
  gatewayClient: GatewayClient;
  keyStore: CryptoKeyStore;
  materialFactory: CryptoMaterialFactory;
  resolveDeviceLabel(): string;
}

export function createCryptoRuntimeCore(dependencies: RuntimeDependencies) {
  return {
    async bootstrapSession(session: CryptoRuntimeSession): Promise<CryptoRuntimeSnapshot> {
      return synchronizeSession(session, dependencies, null);
    },

    async createPendingLinkedDevice(
      session: CryptoRuntimeSession,
    ): Promise<CryptoRuntimeSnapshot> {
      const supportError = assertSupport(dependencies);
      if (supportError !== null) {
        return supportError;
      }

      const existing = await dependencies.keyStore.load(session.profileId);
      if (existing !== null) {
        return synchronizeSession(
          session,
          dependencies,
          "Локальный crypto-device уже существует для этого browser profile.",
        );
      }

      const devices = await dependencies.gatewayClient.listCryptoDevices(session.token);
      const activeDevices = devices.filter((device) => device.status === "active");
      if (activeDevices.length === 0) {
        return synchronizeSession(
          session,
          dependencies,
          "Pending-link bootstrap недоступен без уже активного crypto-device в registry.",
        );
      }

      try {
        const { material, bundle } = await dependencies.materialFactory.createDeviceMaterial({
          accountId: session.profileId,
          login: session.login,
          deviceLabel: dependencies.resolveDeviceLabel(),
          deviceId: "pending-local",
          status: "pending_link",
          bundleVersion: 1,
          publishedAt: null,
          linkIntentId: null,
          linkIntentExpiresAt: null,
        });
        const registered =
          await dependencies.gatewayClient.registerPendingLinkedCryptoDevice(session.token, {
            deviceLabel: material.record.deviceLabel,
            bundle,
          });
        const linkIntent = await dependencies.gatewayClient.createCryptoDeviceLinkIntent(
          session.token,
          registered.device.id,
        );

        const syncedMaterial = dependencies.materialFactory.syncRecordFromServer(
          {
            ...material,
            record: {
              ...material.record,
              cryptoDeviceId: registered.device.id,
            },
          },
          {
            bundleDigestBase64: registered.currentBundle.bundleDigestBase64,
            bundleVersion: registered.currentBundle.bundleVersion,
            publishedAt: registered.currentBundle.publishedAt,
            status: registered.device.status,
            linkIntentId: linkIntent.id,
            linkIntentExpiresAt: linkIntent.expiresAt,
          },
        );
        await dependencies.keyStore.save(syncedMaterial);

        return synchronizeSession(
          session,
          dependencies,
          "Локальный pending crypto-device создан. Теперь он ждёт одобрения trusted device.",
        );
      } catch (error) {
        return runtimeError(
          session,
          dependencies,
          describeGatewayError(
            error,
            "Не удалось зарегистрировать pending crypto-device через gateway.",
          ),
        );
      }
    },

    async publishCurrentBundle(
      session: CryptoRuntimeSession,
    ): Promise<CryptoRuntimeSnapshot> {
      const supportError = assertSupport(dependencies);
      if (supportError !== null) {
        return supportError;
      }

      const localMaterial = await dependencies.keyStore.load(session.profileId);
      if (localMaterial === null) {
        return synchronizeSession(
          session,
          dependencies,
          "Локальный crypto-device ещё не инициализирован в этом browser profile.",
        );
      }

      try {
        await publishBundleForLocalMaterial(session, localMaterial, dependencies);
        return synchronizeSession(
          session,
          dependencies,
          "Текущий public bundle повторно опубликован через gateway.",
        );
      } catch (error) {
        return runtimeError(
          session,
          dependencies,
          describeGatewayError(
            error,
            "Не удалось опубликовать current crypto bundle через gateway.",
          ),
        );
      }
    },

    async approveLinkIntent(
      session: CryptoRuntimeSession,
      linkIntentId: string,
    ): Promise<CryptoRuntimeSnapshot> {
      const supportError = assertSupport(dependencies);
      if (supportError !== null) {
        return supportError;
      }

      const localMaterial = await dependencies.keyStore.load(session.profileId);
      if (localMaterial === null || localMaterial.record.status !== "active") {
        return synchronizeSession(
          session,
          dependencies,
          "Одобрение доступно только из browser profile с уже активным local crypto-device.",
        );
      }

      try {
        const linkIntents = await dependencies.gatewayClient.listCryptoDeviceLinkIntents(
          session.token,
        );
        const targetIntent = linkIntents.find(
          (intent) => intent.id === linkIntentId && intent.status === "pending",
        );
        if (targetIntent === undefined) {
          return synchronizeSession(
            session,
            dependencies,
            "Pending link intent не найден или уже не ждёт одобрения.",
          );
        }

        const proof = await dependencies.materialFactory.buildLinkApprovalProof(
          localMaterial,
          {
            linkIntentId: targetIntent.id,
            approverCryptoDeviceId: localMaterial.record.cryptoDeviceId,
            pendingCryptoDeviceId: targetIntent.pendingCryptoDeviceId,
            pendingBundleDigestBase64: targetIntent.bundleDigestBase64,
            approvalChallengeBase64: targetIntent.approvalChallengeBase64,
            challengeExpiresAt: targetIntent.expiresAt,
            issuedAt: new Date().toISOString(),
          },
        );
        await dependencies.gatewayClient.approveCryptoDeviceLinkIntent(
          session.token,
          linkIntentId,
          localMaterial.record.cryptoDeviceId,
          proof,
        );
        return synchronizeSession(
          session,
          dependencies,
          "Pending link intent одобрен через signed proof текущего active crypto-device.",
        );
      } catch (error) {
        return runtimeError(
          session,
          dependencies,
          describeGatewayError(
            error,
            "Не удалось одобрить pending crypto-device link intent.",
          ),
        );
      }
    },

    async decryptEncryptedDirectMessageV2Envelopes(
      session: CryptoRuntimeSession,
      envelopes: EncryptedDirectMessageV2Envelope[],
    ): Promise<EncryptedDirectMessageV2DecryptedEnvelope[]> {
      const supportError = assertSupport(dependencies);
      if (supportError !== null) {
        return envelopes.map((envelope) => ({
          status: "decrypt_failed",
          messageId: envelope.messageId,
          chatId: envelope.chatId,
          senderUserId: envelope.senderUserId,
          senderCryptoDeviceId: envelope.senderCryptoDeviceId,
          operationKind: envelope.operationKind,
          targetMessageId: envelope.targetMessageId,
          revision: envelope.revision,
          createdAt: envelope.createdAt,
          storedAt: envelope.storedAt,
          failureKind: "runtime_unavailable",
        }));
      }

      const localMaterial = await dependencies.keyStore.load(session.profileId);
      if (localMaterial === null) {
        return envelopes.map((envelope) => ({
          status: "decrypt_failed",
          messageId: envelope.messageId,
          chatId: envelope.chatId,
          senderUserId: envelope.senderUserId,
          senderCryptoDeviceId: envelope.senderCryptoDeviceId,
          operationKind: envelope.operationKind,
          targetMessageId: envelope.targetMessageId,
          revision: envelope.revision,
          createdAt: envelope.createdAt,
          storedAt: envelope.storedAt,
          failureKind: "runtime_unavailable",
        }));
      }

      return Promise.all(
        envelopes.map((envelope) =>
          decryptEncryptedDirectMessageV2Envelope(localMaterial, envelope),
        ),
      );
    },
  };
}

async function synchronizeSession(
  session: CryptoRuntimeSession,
  dependencies: RuntimeDependencies,
  notice: string | null,
): Promise<CryptoRuntimeSnapshot> {
  const supportError = assertSupport(dependencies);
  if (supportError !== null) {
    return supportError;
  }

  try {
    let localMaterial = await dependencies.keyStore.load(session.profileId);
    let devices = await dependencies.gatewayClient.listCryptoDevices(session.token);
    let linkIntents = await dependencies.gatewayClient.listCryptoDeviceLinkIntents(
      session.token,
    );
    let currentBundle: CryptoDeviceBundle | null = null;
    let nextNotice = notice;

    if (localMaterial === null && devices.length === 0) {
      const firstDevice = await registerFirstDevice(session, dependencies);
      localMaterial = firstDevice.localMaterial;
      devices = firstDevice.devices;
      linkIntents = firstDevice.linkIntents;
      currentBundle = firstDevice.currentBundle;
      nextNotice =
        nextNotice ?? "Создан первый локальный crypto-device foundation для текущего аккаунта.";
    }

    if (localMaterial !== null) {
      const localCryptoDeviceID = localMaterial.record.cryptoDeviceId;
      const remoteDevice = devices.find(
        (device) => device.id === localCryptoDeviceID,
      );

      if (remoteDevice === undefined) {
        return buildSnapshot({
          support: "available",
          phase: "error",
          localMaterial,
          devices,
          linkIntents,
          currentBundle: null,
          notice: null,
          errorMessage:
            "Локальный crypto-device не найден в account registry. Автовосстановление trust continuity не выполняется.",
        });
      }

      const remoteDetails = await dependencies.gatewayClient.getCryptoDevice(
        session.token,
        localCryptoDeviceID,
      );
      currentBundle = remoteDetails.currentBundle;

      if (
        remoteDetails.currentBundle === null ||
        remoteDetails.currentBundle.bundleDigestBase64 !==
          localMaterial.record.bundleDigestBase64
      ) {
        const publishResult = await publishBundleForLocalMaterial(
          session,
          localMaterial,
          dependencies,
        );
        currentBundle = publishResult.currentBundle;
        localMaterial = publishResult.localMaterial;
        nextNotice =
          nextNotice ??
          "Локальный public bundle был заново опубликован, чтобы синхронизировать browser keystore и registry.";
      } else {
        localMaterial = dependencies.materialFactory.syncRecordFromServer(localMaterial, {
          bundleDigestBase64: remoteDetails.currentBundle.bundleDigestBase64,
          bundleVersion: remoteDetails.currentBundle.bundleVersion,
          publishedAt: remoteDetails.currentBundle.publishedAt,
          status: remoteDevice.status,
          linkIntentId: localMaterial.record.linkIntentId,
          linkIntentExpiresAt: localMaterial.record.linkIntentExpiresAt,
        });
        await dependencies.keyStore.save(localMaterial);
      }

      if (remoteDevice.status === "pending_link") {
        const matchingIntent = linkIntents.find(
          (intent) =>
            intent.pendingCryptoDeviceId === remoteDevice.id &&
            intent.status === "pending",
        );

        if (matchingIntent === undefined) {
          const createdIntent =
            await dependencies.gatewayClient.createCryptoDeviceLinkIntent(
              session.token,
              remoteDevice.id,
            );
          linkIntents = await dependencies.gatewayClient.listCryptoDeviceLinkIntents(
            session.token,
          );
          localMaterial = dependencies.materialFactory.syncRecordFromServer(localMaterial, {
            bundleDigestBase64: localMaterial.record.bundleDigestBase64,
            bundleVersion: localMaterial.record.lastBundleVersion,
            publishedAt: localMaterial.record.lastBundlePublishedAt,
            status: "pending_link",
            linkIntentId: createdIntent.id,
            linkIntentExpiresAt: createdIntent.expiresAt,
          });
          await dependencies.keyStore.save(localMaterial);
          nextNotice =
            nextNotice ??
            "Для локального pending crypto-device создан новый link intent.";
        } else {
          localMaterial = dependencies.materialFactory.syncRecordFromServer(localMaterial, {
            bundleDigestBase64: localMaterial.record.bundleDigestBase64,
            bundleVersion: localMaterial.record.lastBundleVersion,
            publishedAt: localMaterial.record.lastBundlePublishedAt,
            status: "pending_link",
            linkIntentId: matchingIntent.id,
            linkIntentExpiresAt: matchingIntent.expiresAt,
          });
          await dependencies.keyStore.save(localMaterial);
        }
      }

      devices = await dependencies.gatewayClient.listCryptoDevices(session.token);
      linkIntents = await dependencies.gatewayClient.listCryptoDeviceLinkIntents(
        session.token,
      );
    }

    const phase =
      localMaterial === null && devices.some((device) => device.status === "active")
        ? "attention_required"
        : "ready";

    return buildSnapshot({
      support: "available",
      phase,
      localMaterial,
      devices,
      linkIntents,
      currentBundle,
      notice: nextNotice,
      errorMessage: null,
    });
  } catch (error) {
    return runtimeError(
      session,
      dependencies,
      describeGatewayError(
        error,
        "Не удалось синхронизировать crypto runtime с gateway registry.",
      ),
    );
  }
}

async function registerFirstDevice(
  session: CryptoRuntimeSession,
  dependencies: RuntimeDependencies,
): Promise<{
  localMaterial: LocalCryptoDeviceMaterial;
  devices: CryptoDevice[];
  linkIntents: CryptoDeviceLinkIntent[];
  currentBundle: CryptoDeviceBundle;
}> {
  const { material, bundle } = await dependencies.materialFactory.createDeviceMaterial({
    accountId: session.profileId,
    login: session.login,
    deviceLabel: dependencies.resolveDeviceLabel(),
    deviceId: "first-local",
    status: "active",
    bundleVersion: 1,
    publishedAt: null,
    linkIntentId: null,
    linkIntentExpiresAt: null,
  });
  const registered = await dependencies.gatewayClient.registerFirstCryptoDevice(session.token, {
    deviceLabel: material.record.deviceLabel,
    bundle,
  });
  const syncedMaterial = dependencies.materialFactory.syncRecordFromServer(
    {
      ...material,
      record: {
        ...material.record,
        cryptoDeviceId: registered.device.id,
      },
    },
    {
      bundleDigestBase64: registered.currentBundle.bundleDigestBase64,
      bundleVersion: registered.currentBundle.bundleVersion,
      publishedAt: registered.currentBundle.publishedAt,
      status: registered.device.status,
      linkIntentId: null,
      linkIntentExpiresAt: null,
    },
  );
  await dependencies.keyStore.save(syncedMaterial);

  return {
    localMaterial: syncedMaterial,
    devices: await dependencies.gatewayClient.listCryptoDevices(session.token),
    linkIntents: await dependencies.gatewayClient.listCryptoDeviceLinkIntents(session.token),
    currentBundle: registered.currentBundle,
  };
}

async function publishBundleForLocalMaterial(
  session: CryptoRuntimeSession,
  localMaterial: LocalCryptoDeviceMaterial,
  dependencies: RuntimeDependencies,
): Promise<{
  localMaterial: LocalCryptoDeviceMaterial;
  currentBundle: CryptoDeviceBundle;
}> {
  const bundle = await dependencies.materialFactory.buildBundle(localMaterial);
  let publishProof;
  if (localMaterial.record.status === "active") {
    const challenge =
      await dependencies.gatewayClient.createCryptoDeviceBundlePublishChallenge(
        session.token,
        localMaterial.record.cryptoDeviceId,
      );
    publishProof = await dependencies.materialFactory.buildBundlePublishProof(
      localMaterial,
      {
        cryptoDeviceId: localMaterial.record.cryptoDeviceId,
        previousBundleVersion: challenge.currentBundleVersion,
        previousBundleDigestBase64: challenge.currentBundleDigestBase64,
        newBundleDigestBase64: bundle.bundleDigestBase64,
        publishChallengeBase64: challenge.publishChallengeBase64,
        challengeExpiresAt: challenge.expiresAt,
        issuedAt: new Date().toISOString(),
      },
    );
  }
  const published = await dependencies.gatewayClient.publishCryptoDeviceBundle(
    session.token,
    localMaterial.record.cryptoDeviceId,
    bundle,
    publishProof,
  );
  const syncedMaterial = dependencies.materialFactory.syncRecordFromServer(
    localMaterial,
    {
      bundleDigestBase64: published.currentBundle.bundleDigestBase64,
      bundleVersion: published.currentBundle.bundleVersion,
      publishedAt: published.currentBundle.publishedAt,
      status: published.device.status,
      linkIntentId: localMaterial.record.linkIntentId,
      linkIntentExpiresAt: localMaterial.record.linkIntentExpiresAt,
    },
  );
  await dependencies.keyStore.save(syncedMaterial);

  return {
    localMaterial: syncedMaterial,
    currentBundle: published.currentBundle,
  };
}

function assertSupport(
  dependencies: RuntimeDependencies,
): CryptoRuntimeSnapshot | null {
  if (!dependencies.keyStore.isSupported() || !dependencies.materialFactory.isSupported()) {
    return {
      support: "unavailable",
      phase: "error",
      localDevice: null,
      devices: [],
      linkIntents: [],
      currentBundle: null,
      canCreatePendingDevice: false,
      canApproveLinkIntents: false,
      notice: null,
      errorMessage:
        "Текущий browser runtime не поддерживает required IndexedDB/WebCrypto foundation для локального crypto-device keystore.",
    };
  }

  return null;
}

async function runtimeError(
  session: CryptoRuntimeSession,
  dependencies: RuntimeDependencies,
  message: string,
): Promise<CryptoRuntimeSnapshot> {
  const localMaterial = await dependencies.keyStore
    .load(session.profileId)
    .catch(() => null);

  return buildSnapshot({
    support: "available",
    phase: "error",
    localMaterial,
    devices: [],
    linkIntents: [],
    currentBundle: null,
    notice: null,
    errorMessage: message,
  });
}

function buildSnapshot(input: {
  support: "available" | "unavailable";
  phase: "ready" | "attention_required" | "error";
  localMaterial: LocalCryptoDeviceMaterial | null;
  devices: CryptoDevice[];
  linkIntents: CryptoDeviceLinkIntent[];
  currentBundle: CryptoDeviceBundle | null;
  notice: string | null;
  errorMessage: string | null;
}): CryptoRuntimeSnapshot {
  const localDevice = input.localMaterial?.record ?? null;
  const hasRemoteActiveDevice = input.devices.some((device) => device.status === "active");

  return {
    support: input.support,
    phase: input.phase,
    localDevice,
    devices: input.devices,
    linkIntents: input.linkIntents,
    currentBundle: input.currentBundle,
    canCreatePendingDevice: localDevice === null && hasRemoteActiveDevice,
    canApproveLinkIntents:
      localDevice?.status === "active" &&
      input.linkIntents.some((intent) => intent.status === "pending"),
    notice: input.notice,
    errorMessage: input.errorMessage,
  };
}
