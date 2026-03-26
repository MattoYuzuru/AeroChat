import type {
  EncryptedDirectMessageV2Envelope,
  EncryptedGroupEnvelope,
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
import {
  decryptEncryptedGroupEnvelope,
  encryptEncryptedGroupPayload,
  type EncryptedGroupPayloadV1,
} from "./encrypted-group-codec";
import {
  decryptEncryptedDirectMessageV2Envelope,
  encryptEncryptedDirectMessageV2Payload,
  type EncryptedDirectMessageV2PayloadV1,
} from "./encrypted-v2-codec";
import {
  decryptEncryptedMediaAttachment,
  finalizeEncryptedMediaAttachmentDescriptorDraft,
  prepareEncryptedMediaRelayUpload,
  type EncryptedMediaAttachmentDescriptorV1,
} from "./encrypted-media-relay";
import type {
  DecryptedEncryptedMediaAttachment,
  EncryptedGroupDecryptedEnvelope,
  EncryptedDirectMessageV2DecryptedEnvelope,
  EncryptedMediaAttachmentDescriptor,
  EncryptedDirectMessageV2OutboundSendResult,
  EncryptedGroupOutboundSendResult,
  CryptoRuntimeSession,
  CryptoRuntimeSnapshot,
  LocalCryptoDeviceMaterial,
  PreparedEncryptedMediaRelayUpload,
} from "./types";

interface RuntimeDependencies {
  gatewayClient: GatewayClient;
  keyStore: CryptoKeyStore;
  materialFactory: CryptoMaterialFactory;
  resolveDeviceLabel(): string;
}

type EncryptedDirectMessageV2MutationInput =
  | {
      kind: "content";
      chatId: string;
      text: string;
      replyToMessageId?: string | null;
      attachmentDrafts?: Array<{
        draftId: string;
        attachmentId: string;
      }>;
    }
  | {
      kind: "edit";
      chatId: string;
      targetMessageId: string;
      nextRevision: number;
      text: string;
      replyToMessageId?: string | null;
      attachmentDrafts?: Array<{
        draftId: string;
        attachmentId: string;
      }>;
    }
  | {
      kind: "tombstone";
      chatId: string;
      targetMessageId: string;
      nextRevision: number;
    };

type EncryptedGroupMutationInput =
  | {
      kind: "content";
      groupId: string;
      text: string;
      replyToMessageId?: string | null;
      attachmentDrafts?: Array<{
        draftId: string;
        attachmentId: string;
      }>;
    }
  | {
      kind: "edit";
      groupId: string;
      targetMessageId: string;
      nextRevision: number;
      text: string;
      replyToMessageId?: string | null;
    }
  | {
      kind: "tombstone";
      groupId: string;
      targetMessageId: string;
      nextRevision: number;
    };

export function createCryptoRuntimeCore(dependencies: RuntimeDependencies) {
  const encryptedMediaDrafts = new Map<string, EncryptedMediaAttachmentDescriptorV1>();
  const encryptedMediaDescriptors = new Map<string, EncryptedMediaAttachmentDescriptorV1>();

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
          decryptEncryptedDirectMessageV2Envelope(localMaterial, envelope, {
            onEncryptedMediaDescriptor(descriptor) {
              cacheEncryptedMediaDescriptor(encryptedMediaDescriptors, descriptor);
            },
          }),
        ),
      );
    },

    async decryptEncryptedGroupEnvelopes(
      session: CryptoRuntimeSession,
      envelopes: EncryptedGroupEnvelope[],
    ): Promise<EncryptedGroupDecryptedEnvelope[]> {
      const supportError = assertSupport(dependencies);
      if (supportError !== null) {
        return envelopes.map((envelope) => ({
          status: "decrypt_failed",
          messageId: envelope.messageId,
          groupId: envelope.groupId,
          threadId: envelope.threadId,
          mlsGroupId: envelope.mlsGroupId,
          rosterVersion: envelope.rosterVersion,
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
          groupId: envelope.groupId,
          threadId: envelope.threadId,
          mlsGroupId: envelope.mlsGroupId,
          rosterVersion: envelope.rosterVersion,
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
          decryptEncryptedGroupEnvelope(localMaterial, envelope, {
            onEncryptedMediaDescriptor(descriptor) {
              cacheEncryptedMediaDescriptor(encryptedMediaDescriptors, descriptor);
            },
          }),
        ),
      );
    },

    async prepareEncryptedMediaRelayUpload(
      session: CryptoRuntimeSession,
      input: {
        fileName: string;
        mimeType: string;
        fileBytes: ArrayBuffer;
      },
    ): Promise<PreparedEncryptedMediaRelayUpload> {
      const supportError = assertSupport(dependencies);
      if (supportError !== null) {
        throw new Error(
          supportError.errorMessage ??
            "Текущий browser runtime не поддерживает encrypted media relay v1.",
        );
      }

      const localMaterial = await dependencies.keyStore.load(session.profileId);
      if (localMaterial === null || localMaterial.record.status !== "active") {
        throw new Error(
          "Encrypted media relay v1 доступен только для browser profile с active local crypto-device.",
        );
      }

      const prepared = await prepareEncryptedMediaRelayUpload(input);
      cacheEncryptedMediaDraft(encryptedMediaDrafts, prepared.draftId, prepared.descriptor);
      return prepared.relayUpload;
    },

    async decryptEncryptedMediaAttachment(
      session: CryptoRuntimeSession,
      input: {
        attachmentId: string;
        ciphertextBytes: ArrayBuffer;
      },
    ): Promise<DecryptedEncryptedMediaAttachment> {
      const supportError = assertSupport(dependencies);
      if (supportError !== null) {
        throw new Error(
          supportError.errorMessage ??
            "Текущий browser runtime не поддерживает local media decrypt.",
        );
      }

      const descriptor = encryptedMediaDescriptors.get(input.attachmentId);
      if (descriptor === undefined) {
        throw new Error(
          "Encrypted attachment descriptor не найден в bounded local runtime cache.",
        );
      }

      const localMaterial = await dependencies.keyStore.load(session.profileId);
      if (localMaterial === null || localMaterial.record.status !== "active") {
        throw new Error(
          "Local media decrypt доступен только для browser profile с active local crypto-device.",
        );
      }

      return decryptEncryptedMediaAttachment({
        attachmentId: input.attachmentId,
        ciphertextBytes: input.ciphertextBytes,
        descriptor,
      });
    },

    async sendEncryptedDirectMessageV2Content(
      session: CryptoRuntimeSession,
      input: {
        chatId: string;
        text: string;
        replyToMessageId?: string | null;
        attachmentDrafts?: Array<{
          draftId: string;
          attachmentId: string;
        }>;
      },
    ): Promise<EncryptedDirectMessageV2OutboundSendResult> {
      return sendEncryptedDirectMessageV2Mutation(
        dependencies,
        encryptedMediaDrafts,
        encryptedMediaDescriptors,
        session,
        {
          kind: "content",
          chatId: input.chatId,
          text: input.text,
          replyToMessageId: input.replyToMessageId,
          attachmentDrafts: input.attachmentDrafts,
        },
      );
    },

    async sendEncryptedDirectMessageV2Edit(
      session: CryptoRuntimeSession,
      input: {
        chatId: string;
        targetMessageId: string;
        nextRevision: number;
        text: string;
        replyToMessageId?: string | null;
        attachmentDrafts?: Array<{
          draftId: string;
          attachmentId: string;
        }>;
      },
    ): Promise<EncryptedDirectMessageV2OutboundSendResult> {
      return sendEncryptedDirectMessageV2Mutation(
        dependencies,
        encryptedMediaDrafts,
        encryptedMediaDescriptors,
        session,
        {
          kind: "edit",
          chatId: input.chatId,
          targetMessageId: input.targetMessageId,
          nextRevision: input.nextRevision,
          text: input.text,
          replyToMessageId: input.replyToMessageId,
          attachmentDrafts: input.attachmentDrafts,
        },
      );
    },

    async sendEncryptedDirectMessageV2Tombstone(
      session: CryptoRuntimeSession,
      input: {
        chatId: string;
        targetMessageId: string;
        nextRevision: number;
      },
    ): Promise<EncryptedDirectMessageV2OutboundSendResult> {
      return sendEncryptedDirectMessageV2Mutation(
        dependencies,
        encryptedMediaDrafts,
        encryptedMediaDescriptors,
        session,
        {
          kind: "tombstone",
          chatId: input.chatId,
          targetMessageId: input.targetMessageId,
          nextRevision: input.nextRevision,
        },
      );
    },

    async sendEncryptedGroupContent(
      session: CryptoRuntimeSession,
      input: {
        groupId: string;
        text: string;
        replyToMessageId?: string | null;
        attachmentDrafts?: Array<{
          draftId: string;
          attachmentId: string;
        }>;
      },
    ): Promise<EncryptedGroupOutboundSendResult> {
      return sendEncryptedGroupMutation(
        dependencies,
        encryptedMediaDrafts,
        encryptedMediaDescriptors,
        session,
        {
          kind: "content",
          groupId: input.groupId,
          text: input.text,
          replyToMessageId: input.replyToMessageId,
          attachmentDrafts: input.attachmentDrafts,
        },
      );
    },

    async sendEncryptedGroupEdit(
      session: CryptoRuntimeSession,
      input: {
        groupId: string;
        targetMessageId: string;
        nextRevision: number;
        text: string;
        replyToMessageId?: string | null;
      },
    ): Promise<EncryptedGroupOutboundSendResult> {
      return sendEncryptedGroupMutation(
        dependencies,
        encryptedMediaDrafts,
        encryptedMediaDescriptors,
        session,
        {
          kind: "edit",
          groupId: input.groupId,
          targetMessageId: input.targetMessageId,
          nextRevision: input.nextRevision,
          text: input.text,
          replyToMessageId: input.replyToMessageId,
        },
      );
    },

    async sendEncryptedGroupTombstone(
      session: CryptoRuntimeSession,
      input: {
        groupId: string;
        targetMessageId: string;
        nextRevision: number;
      },
    ): Promise<EncryptedGroupOutboundSendResult> {
      return sendEncryptedGroupMutation(
        dependencies,
        encryptedMediaDrafts,
        encryptedMediaDescriptors,
        session,
        {
          kind: "tombstone",
          groupId: input.groupId,
          targetMessageId: input.targetMessageId,
          nextRevision: input.nextRevision,
        },
      );
    },
  };
}

function normalizeEncryptedAttachmentDraftInputs(
  drafts:
    | Array<{
        draftId: string;
        attachmentId: string;
      }>
    | undefined,
): Array<{
  draftId: string;
  attachmentId: string;
}> {
  if (drafts === undefined || drafts.length === 0) {
    return [];
  }

  const normalized = new Map<string, { draftId: string; attachmentId: string }>();
  for (const draft of drafts) {
    const draftId = draft.draftId.trim();
    const attachmentId = draft.attachmentId.trim();
    if (draftId === "" || attachmentId === "") {
      throw new Error("Encrypted attachment draft должен содержать draftId и attachmentId.");
    }
    if (normalized.has(attachmentId)) {
      throw new Error("Duplicate encrypted attachment ids не допускаются.");
    }
    normalized.set(attachmentId, { draftId, attachmentId });
  }

  return Array.from(normalized.values());
}

function resolveEncryptedMediaAttachmentDescriptors(
  drafts: Map<string, EncryptedMediaAttachmentDescriptorV1>,
  selectedDrafts: Array<{
    draftId: string;
    attachmentId: string;
  }>,
): EncryptedMediaAttachmentDescriptorV1[] {
  return selectedDrafts.map((selectedDraft) => {
    const descriptorDraft = drafts.get(selectedDraft.draftId);
    if (descriptorDraft === undefined) {
      throw new Error(
        "Encrypted media draft больше не найден в bounded local runtime cache.",
      );
    }

    return finalizeEncryptedMediaAttachmentDescriptorDraft(
      descriptorDraft,
      selectedDraft.attachmentId,
    );
  });
}

async function sendEncryptedDirectMessageV2Mutation(
  dependencies: RuntimeDependencies,
  encryptedMediaDrafts: Map<string, EncryptedMediaAttachmentDescriptorV1>,
  encryptedMediaDescriptors: Map<string, EncryptedMediaAttachmentDescriptorV1>,
  session: CryptoRuntimeSession,
  input: EncryptedDirectMessageV2MutationInput,
): Promise<EncryptedDirectMessageV2OutboundSendResult> {
  const supportError = assertSupport(dependencies);
  if (supportError !== null) {
    throw new Error(
      supportError.errorMessage ??
        "Текущий browser runtime не поддерживает encrypted DM v2 mutation send.",
    );
  }

  const normalizedChatId = input.chatId.trim();
  if (normalizedChatId === "") {
    throw new Error("Не выбран direct chat для encrypted DM v2 mutation.");
  }

  const localMaterial = await dependencies.keyStore.load(session.profileId);
  if (localMaterial === null || localMaterial.record.status !== "active") {
    throw new Error(
      "Encrypted DM v2 mutation доступен только для browser profile с active local crypto-device.",
    );
  }
  const localBundle = await dependencies.materialFactory.buildBundle(localMaterial);
  if (localBundle.signedPrekeyPublicBase64.trim() === "") {
    throw new Error(
      "Текущий local crypto-device не имеет signed prekey для server-backed self-delivery.",
    );
  }

  const sendBootstrap =
    await dependencies.gatewayClient.getEncryptedDirectMessageV2SendBootstrap(
      session.token,
      normalizedChatId,
      localMaterial.record.cryptoDeviceId,
    );
  const targetDevices = [
    {
      cryptoDeviceId: localMaterial.record.cryptoDeviceId,
      signedPrekeyPublicBase64: localBundle.signedPrekeyPublicBase64,
    },
    ...sendBootstrap.senderOtherDevices.map((device) => ({
      cryptoDeviceId: device.cryptoDeviceId,
      signedPrekeyPublicBase64: device.signedPrekeyPublicBase64,
    })),
    ...sendBootstrap.recipientDevices.map((device) => ({
      cryptoDeviceId: device.cryptoDeviceId,
      signedPrekeyPublicBase64: device.signedPrekeyPublicBase64,
    })),
  ];
  if (targetDevices.length === 0) {
    throw new Error("Encrypted DM v2 send bootstrap не вернул target crypto-device roster.");
  }

  const normalizedReplyToMessageId =
    input.kind === "tombstone"
      ? null
      : normalizeOptionalMessageId(input.replyToMessageId ?? null);
  const normalizedAttachmentDrafts =
    input.kind === "tombstone"
      ? []
      : normalizeEncryptedAttachmentDraftInputs(input.attachmentDrafts);
  const attachmentDescriptors =
    input.kind === "tombstone"
      ? []
      : resolveEncryptedMediaAttachmentDescriptors(
          encryptedMediaDrafts,
          normalizedAttachmentDrafts,
        );
  const normalizedText =
    input.kind === "tombstone" ? "" : normalizeEncryptedMutationText(input.text);
  if (
    input.kind !== "tombstone" &&
    normalizedText === "" &&
    attachmentDescriptors.length === 0
  ) {
    throw new Error(
      "Encrypted DM v2 mutation требует text payload или хотя бы один encrypted attachment descriptor.",
    );
  }

  const operationKind =
    input.kind === "content"
      ? "content"
      : input.kind === "edit"
        ? "edit"
        : "tombstone";
  const targetMessageId =
    input.kind === "content"
      ? null
      : normalizeRequiredMessageId(input.targetMessageId, "target encrypted DM v2 message");
  const revision = input.kind === "content" ? 1 : normalizeNextRevision(input.nextRevision);
  const messageId = createLogicalMessageId();
  const createdAt = new Date().toISOString();

  let payload: EncryptedDirectMessageV2PayloadV1;
  if (input.kind === "tombstone") {
    payload = {
      schema: "aerochat.web.encrypted_direct_message_v2.payload.v1",
      operation: "tombstone",
      deletedAt: createdAt,
    };
  } else if (input.kind === "edit") {
    payload = {
      schema: "aerochat.web.encrypted_direct_message_v2.payload.v1",
      operation: "edit",
      replyToMessageId: normalizedReplyToMessageId,
      message: {
        text: normalizedText === "" ? null : normalizedText,
        markdownPolicy:
          normalizedText === "" ? null : "MARKDOWN_POLICY_SAFE_SUBSET_V1",
        attachments: attachmentDescriptors,
      },
      editedAt: createdAt,
    };
  } else {
    payload = {
      schema: "aerochat.web.encrypted_direct_message_v2.payload.v1",
      operation: "content",
      replyToMessageId: normalizedReplyToMessageId,
      message: {
        text: normalizedText === "" ? null : normalizedText,
        markdownPolicy:
          normalizedText === "" ? null : "MARKDOWN_POLICY_SAFE_SUBSET_V1",
        attachments: attachmentDescriptors,
      },
    };
  }

  const deliveries = await Promise.all(
    targetDevices.map(async (device) => {
      if (device.signedPrekeyPublicBase64.trim() === "") {
        throw new Error(
          `Active target crypto-device ${device.cryptoDeviceId} не имеет public signed prekey для bootstrap send.`,
        );
      }

      const encrypted = await encryptEncryptedDirectMessageV2Payload({
        recipientSignedPrekeyPublicBase64: device.signedPrekeyPublicBase64,
        metadata: {
          messageId,
          chatId: normalizedChatId,
          senderUserId: session.profileId,
          senderCryptoDeviceId: localMaterial.record.cryptoDeviceId,
          operationKind,
          targetMessageId,
          revision,
          createdAt,
          recipientCryptoDeviceId: device.cryptoDeviceId,
        },
        payload,
      });

      return {
        recipientCryptoDeviceId: device.cryptoDeviceId,
        transportHeader: encrypted.transportHeader,
        ciphertext: encrypted.ciphertext,
      };
    }),
  );

  const storedEnvelope = await dependencies.gatewayClient.sendEncryptedDirectMessageV2(
    session.token,
    {
      chatId: normalizedChatId,
      messageId,
      messageCreatedAt: createdAt,
      senderCryptoDeviceId: localMaterial.record.cryptoDeviceId,
      operationKind,
      targetMessageId,
      revision,
      attachmentIds: attachmentDescriptors.map((descriptor) => descriptor.attachmentId),
      deliveries,
    },
  );

  for (const descriptor of attachmentDescriptors) {
    cacheEncryptedMediaDescriptor(encryptedMediaDescriptors, descriptor);
    encryptedMediaDrafts.delete(
      normalizedAttachmentDrafts.find(
        (draft) => draft.attachmentId === descriptor.attachmentId,
      )?.draftId ?? "",
    );
  }

  return {
    storedEnvelope,
    localProjection: {
      status: "ready",
      messageId: storedEnvelope.messageId,
      chatId: storedEnvelope.chatId,
      senderUserId: storedEnvelope.senderUserId,
      senderCryptoDeviceId: storedEnvelope.senderCryptoDeviceId,
      operationKind,
      targetMessageId,
      replyToMessageId: normalizedReplyToMessageId,
      revision: storedEnvelope.revision,
      createdAt: storedEnvelope.createdAt,
      storedAt: storedEnvelope.storedAt,
      payloadSchema: "aerochat.web.encrypted_direct_message_v2.payload.v1",
      text: input.kind === "tombstone" ? null : normalizedText === "" ? null : normalizedText,
      markdownPolicy:
        input.kind === "tombstone" || normalizedText === ""
          ? null
          : "MARKDOWN_POLICY_SAFE_SUBSET_V1",
      attachments: attachmentDescriptors.map(stripEncryptedMediaAttachmentDescriptor),
      editedAt: input.kind === "edit" ? createdAt : null,
      deletedAt: input.kind === "tombstone" ? createdAt : null,
    },
  };
}

async function sendEncryptedGroupMutation(
  dependencies: RuntimeDependencies,
  encryptedMediaDrafts: Map<string, EncryptedMediaAttachmentDescriptorV1>,
  encryptedMediaDescriptors: Map<string, EncryptedMediaAttachmentDescriptorV1>,
  session: CryptoRuntimeSession,
  input: EncryptedGroupMutationInput,
): Promise<EncryptedGroupOutboundSendResult> {
  const supportError = assertSupport(dependencies);
  if (supportError !== null) {
    throw new Error(
      supportError.errorMessage ??
        "Текущий browser runtime не поддерживает encrypted group mutation send.",
    );
  }

  const normalizedGroupId = input.groupId.trim();
  if (normalizedGroupId === "") {
    throw new Error("Не выбрана группа для encrypted group mutation.");
  }

  const localMaterial = await dependencies.keyStore.load(session.profileId);
  if (localMaterial === null || localMaterial.record.status !== "active") {
    throw new Error(
      "Encrypted group mutation доступен только для browser profile с active local crypto-device.",
    );
  }

  const bootstrap = await dependencies.gatewayClient.getEncryptedGroupBootstrap(
    session.token,
    normalizedGroupId,
    localMaterial.record.cryptoDeviceId,
  );
  if (
    bootstrap.lane.threadId.trim() === "" ||
    bootstrap.lane.mlsGroupId.trim() === "" ||
    bootstrap.lane.rosterVersion <= 0
  ) {
    throw new Error(
      "Encrypted group bootstrap вернул неполный control-plane state для outbound mutation.",
    );
  }
  const targetDevices = bootstrap.rosterDevices.map((device) => ({
    cryptoDeviceId: device.cryptoDeviceId,
    signedPrekeyPublicBase64: device.signedPrekeyPublicBase64,
  }));
  if (targetDevices.length === 0) {
    throw new Error(
      "Encrypted group bootstrap не вернул eligible crypto-device roster для send.",
    );
  }
  if (
    !targetDevices.some(
      (device) => device.cryptoDeviceId === localMaterial.record.cryptoDeviceId,
    )
  ) {
    throw new Error(
      "Текущий local crypto-device не попал в encrypted group roster и не может отправить bootstrap payload.",
    );
  }
  for (const targetDevice of targetDevices) {
    if (targetDevice.signedPrekeyPublicBase64.trim() === "") {
      throw new Error(
        `Active group crypto-device ${targetDevice.cryptoDeviceId} не имеет signed prekey для bootstrap send.`,
      );
    }
  }

  const normalizedReplyToMessageId =
    input.kind === "tombstone"
      ? null
      : normalizeOptionalMessageId(input.replyToMessageId ?? null);
  const normalizedAttachmentDrafts =
    input.kind === "content"
      ? normalizeEncryptedAttachmentDraftInputs(input.attachmentDrafts)
      : [];
  const attachmentDescriptors =
    input.kind === "content"
      ? resolveEncryptedMediaAttachmentDescriptors(
          encryptedMediaDrafts,
          normalizedAttachmentDrafts,
        )
      : [];
  const normalizedText =
    input.kind === "tombstone" ? "" : normalizeEncryptedMutationText(input.text);
  if (
    input.kind !== "tombstone" &&
    normalizedText === "" &&
    attachmentDescriptors.length === 0
  ) {
    throw new Error(
      "Encrypted group mutation требует text payload или хотя бы один encrypted attachment descriptor.",
    );
  }

  const operationKind =
    input.kind === "content"
      ? "content"
      : input.kind === "edit"
        ? "edit"
        : "tombstone";
  const targetMessageId =
    input.kind === "content"
      ? null
      : normalizeRequiredMessageId(input.targetMessageId, "target encrypted group message");
  const revision = input.kind === "content" ? 1 : normalizeNextRevision(input.nextRevision);
  const messageId = createLogicalMessageId();
  const createdAt = new Date().toISOString();
  let payload: EncryptedGroupPayloadV1;
  if (input.kind === "tombstone") {
    payload = {
      schema: "aerochat.web.encrypted_group_message_v1.payload.v1",
      operation: "tombstone",
      deletedAt: createdAt,
    };
  } else if (input.kind === "edit") {
    payload = {
      schema: "aerochat.web.encrypted_group_message_v1.payload.v1",
      operation: "edit",
      replyToMessageId: normalizedReplyToMessageId,
      message: {
        text: normalizedText,
        markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
      },
      editedAt: createdAt,
    };
  } else {
    payload = {
      schema: "aerochat.web.encrypted_group_message_v1.payload.v1",
      operation: "content",
      replyToMessageId: normalizedReplyToMessageId,
      message: {
        text: normalizedText === "" ? null : normalizedText,
        markdownPolicy:
          normalizedText === "" ? null : "MARKDOWN_POLICY_SAFE_SUBSET_V1",
        attachments: attachmentDescriptors,
      },
    };
  }

  const encrypted = await encryptEncryptedGroupPayload({
    recipientDevices: targetDevices,
    metadata: {
      messageId,
      groupId: normalizedGroupId,
      threadId: bootstrap.lane.threadId,
      mlsGroupId: bootstrap.lane.mlsGroupId,
      rosterVersion: bootstrap.lane.rosterVersion,
      senderUserId: session.profileId,
      senderCryptoDeviceId: localMaterial.record.cryptoDeviceId,
      operationKind,
      targetMessageId,
      revision,
      createdAt,
    },
    payload,
  });

  const storedEnvelope = await dependencies.gatewayClient.sendEncryptedGroupMessage(
    session.token,
    {
      groupId: normalizedGroupId,
      messageId,
      messageCreatedAt: createdAt,
      mlsGroupId: bootstrap.lane.mlsGroupId,
      rosterVersion: bootstrap.lane.rosterVersion,
      senderCryptoDeviceId: localMaterial.record.cryptoDeviceId,
      operationKind,
      targetMessageId,
      revision,
      attachmentIds: attachmentDescriptors.map((descriptor) => descriptor.attachmentId),
      ciphertext: encrypted.ciphertext,
    },
  );

  for (const descriptor of attachmentDescriptors) {
    cacheEncryptedMediaDescriptor(encryptedMediaDescriptors, descriptor);
    encryptedMediaDrafts.delete(
      normalizedAttachmentDrafts.find(
        (draft) => draft.attachmentId === descriptor.attachmentId,
      )?.draftId ?? "",
    );
  }

  return {
    storedEnvelope,
    localProjection: {
      status: "ready",
      messageId: storedEnvelope.messageId,
      groupId: storedEnvelope.groupId,
      threadId: storedEnvelope.threadId,
      mlsGroupId: storedEnvelope.mlsGroupId,
      rosterVersion: storedEnvelope.rosterVersion,
      senderUserId: storedEnvelope.senderUserId,
      senderCryptoDeviceId: storedEnvelope.senderCryptoDeviceId,
      operationKind,
      targetMessageId,
      replyToMessageId: normalizedReplyToMessageId,
      revision: storedEnvelope.revision,
      createdAt: storedEnvelope.createdAt,
      storedAt: storedEnvelope.storedAt,
      payloadSchema: "aerochat.web.encrypted_group_message_v1.payload.v1",
      text: input.kind === "tombstone" ? null : normalizedText === "" ? null : normalizedText,
      markdownPolicy:
        input.kind === "tombstone" || normalizedText === ""
          ? null
          : "MARKDOWN_POLICY_SAFE_SUBSET_V1",
      attachments:
        input.kind === "content"
          ? attachmentDescriptors.map(stripEncryptedMediaAttachmentDescriptor)
          : null,
      editedAt: input.kind === "edit" ? createdAt : null,
      deletedAt: input.kind === "tombstone" ? createdAt : null,
    },
  };
}

function normalizeEncryptedMutationText(value: string): string {
  return value.trim();
}

function normalizeOptionalMessageId(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function normalizeRequiredMessageId(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw new Error(`${label} обязателен для encrypted mutation.`);
  }

  return normalized;
}

function normalizeNextRevision(value: number): number {
  if (!Number.isInteger(value) || value <= 1) {
    throw new Error("Encrypted mutation должна публиковаться с next revision больше 1.");
  }

  return value;
}

function stripEncryptedMediaAttachmentDescriptor(
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

function cacheEncryptedMediaDraft(
  drafts: Map<string, EncryptedMediaAttachmentDescriptorV1>,
  draftId: string,
  descriptor: EncryptedMediaAttachmentDescriptorV1,
) {
  drafts.set(draftId, descriptor);
  trimEncryptedMediaMap(drafts, 32);
}

function cacheEncryptedMediaDescriptor(
  descriptors: Map<string, EncryptedMediaAttachmentDescriptorV1>,
  descriptor: EncryptedMediaAttachmentDescriptorV1,
) {
  if (descriptor.attachmentId.trim() === "") {
    return;
  }

  descriptors.set(descriptor.attachmentId, descriptor);
  trimEncryptedMediaMap(descriptors, 200);
}

function trimEncryptedMediaMap(
  values: Map<string, EncryptedMediaAttachmentDescriptorV1>,
  limit: number,
) {
  for (; values.size > limit; ) {
    const oldestKey = values.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    values.delete(oldestKey);
  }
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
      const localWasPendingLink = localMaterial.record.status === "pending_link";
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
      if (localWasPendingLink && remoteDevice.status === "active") {
        nextNotice =
          nextNotice ??
          "Локальный linked crypto-device активирован. В текущем slice он увидит только новые encrypted сообщения, отправленные после активации; backfill старой encrypted history пока не выполняется.";
      }
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

function createLogicalMessageId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const byte6 = bytes[6];
  const byte8 = bytes[8];
  if (byte6 === undefined || byte8 === undefined) {
    throw new Error("Не удалось подготовить local logical message id для encrypted DM v2.");
  }
  bytes[6] = (byte6 & 0x0f) | 0x40;
  bytes[8] = (byte8 & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
