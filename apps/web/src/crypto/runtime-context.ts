import { createContext } from "react";
import type {
  CryptoRuntimeClient,
  CryptoRuntimeSession,
  CryptoRuntimeSnapshot,
  DecryptedEncryptedMediaAttachment,
  EncryptedGroupDecryptedEnvelope,
  EncryptedDirectMessageV2DecryptedEnvelope,
  EncryptedDirectMessageV2OutboundSendResult,
  EncryptedGroupOutboundSendResult,
  PreparedEncryptedMediaRelayUpload,
} from "./types";
import type {
  EncryptedDirectMessageV2Envelope,
  EncryptedGroupEnvelope,
} from "../gateway/types";

export type CryptoContextState =
  | {
      status: "disabled";
      snapshot: null;
      isActionPending: false;
      pendingLabel: null;
    }
  | {
      status: "bootstrapping" | "ready";
      snapshot: CryptoRuntimeSnapshot | null;
      isActionPending: boolean;
      pendingLabel: string | null;
    };

export interface CryptoRuntimeContextValue {
  state: CryptoContextState;
  refresh(): Promise<void>;
  createPendingLinkedDevice(): Promise<void>;
  publishCurrentBundle(): Promise<void>;
  approveLinkIntent(linkIntentId: string): Promise<void>;
  decryptEncryptedGroupEnvelopes(
    envelopes: EncryptedGroupEnvelope[],
  ): Promise<EncryptedGroupDecryptedEnvelope[]>;
  decryptEncryptedDirectMessageV2Envelopes(
    envelopes: EncryptedDirectMessageV2Envelope[],
  ): Promise<EncryptedDirectMessageV2DecryptedEnvelope[]>;
  prepareEncryptedMediaRelayUpload(input: {
    fileName: string;
    mimeType: string;
    fileBytes: ArrayBuffer;
  }): Promise<PreparedEncryptedMediaRelayUpload | null>;
  decryptEncryptedMediaAttachment(input: {
    attachmentId: string;
    ciphertextBytes: ArrayBuffer;
  }): Promise<DecryptedEncryptedMediaAttachment | null>;
  sendEncryptedDirectMessageV2Content(
    chatId: string,
    text: string,
    replyToMessageId?: string | null,
    attachmentDrafts?: Array<{
      draftId: string;
      attachmentId: string;
    }>,
  ): Promise<EncryptedDirectMessageV2OutboundSendResult | null>;
  sendEncryptedDirectMessageV2Edit(
    chatId: string,
    targetMessageId: string,
    nextRevision: number,
    text: string,
    replyToMessageId?: string | null,
    attachmentDrafts?: Array<{
      draftId: string;
      attachmentId: string;
    }>,
  ): Promise<EncryptedDirectMessageV2OutboundSendResult | null>;
  sendEncryptedDirectMessageV2Tombstone(
    chatId: string,
    targetMessageId: string,
    nextRevision: number,
  ): Promise<EncryptedDirectMessageV2OutboundSendResult | null>;
  sendEncryptedGroupContent(
    groupId: string,
    text: string,
    replyToMessageId?: string | null,
  ): Promise<EncryptedGroupOutboundSendResult | null>;
  sendEncryptedGroupEdit(
    groupId: string,
    targetMessageId: string,
    nextRevision: number,
    text: string,
    replyToMessageId?: string | null,
  ): Promise<EncryptedGroupOutboundSendResult | null>;
  sendEncryptedGroupTombstone(
    groupId: string,
    targetMessageId: string,
    nextRevision: number,
  ): Promise<EncryptedGroupOutboundSendResult | null>;
}

export const CryptoRuntimeContext = createContext<CryptoRuntimeContextValue | null>(null);

export type RuntimeAction = (
  runtime: CryptoRuntimeClient,
  session: CryptoRuntimeSession,
) => Promise<CryptoRuntimeSnapshot>;
