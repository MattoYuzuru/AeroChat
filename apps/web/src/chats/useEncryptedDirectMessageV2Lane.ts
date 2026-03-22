import { useEffect, useRef, useState } from "react";
import { useCryptoRuntime } from "../crypto/useCryptoRuntime";
import type { EncryptedDirectMessageV2ProjectionEntry } from "./encrypted-v2-projection";
import {
  describeEncryptedDirectMessageV2Failure,
  encryptedDirectMessageV2ProjectionLimit,
  mergeEncryptedDirectMessageV2Projection,
} from "./encrypted-v2-projection";
import { gatewayClient } from "../gateway/runtime";
import { type EncryptedDirectMessageV2Envelope } from "../gateway/types";
import {
  listBufferedEncryptedDirectMessageV2RealtimeEvents,
  subscribeEncryptedDirectMessageV2RealtimeEvents,
} from "./encrypted-v2-realtime";
import {
  discardBufferedLocalEncryptedDirectMessageV2Projection,
  listBufferedLocalEncryptedDirectMessageV2Projection,
  subscribeLocalEncryptedDirectMessageV2Projection,
} from "./encrypted-v2-local-outbound";
import { resolveActiveRealtimeCryptoDeviceId } from "../crypto/realtime-bridge-helpers";

interface UseEncryptedDirectMessageV2LaneOptions {
  enabled: boolean;
  token: string;
  chatId: string | null;
}

export interface EncryptedDirectMessageV2LaneState {
  status: "idle" | "loading" | "ready" | "unavailable" | "error";
  items: EncryptedDirectMessageV2ProjectionEntry[];
  errorMessage: string | null;
}

interface LoadedEncryptedDirectMessageV2LaneState {
  requestKey: string | null;
  status: "ready" | "error";
  items: EncryptedDirectMessageV2ProjectionEntry[];
  errorMessage: string | null;
}

export function useEncryptedDirectMessageV2Lane({
  enabled,
  token,
  chatId,
}: UseEncryptedDirectMessageV2LaneOptions): EncryptedDirectMessageV2LaneState {
  const cryptoRuntime = useCryptoRuntime();
  const activeCryptoDeviceId = resolveActiveRealtimeCryptoDeviceId(cryptoRuntime.state);
  const activeChatId = chatId?.trim() ?? "";
  const [loadedState, setLoadedState] = useState<LoadedEncryptedDirectMessageV2LaneState>({
    requestKey: null,
    status: "ready",
    items: [],
    errorMessage: null,
  });
  const requestVersionRef = useRef(0);
  const loadDescriptor = resolveEncryptedLaneLoadDescriptor({
    enabled,
    activeChatId,
    activeCryptoDeviceId,
    cryptoRuntimeState: cryptoRuntime.state,
    token,
  });

  useEffect(() => {
    if (loadDescriptor.kind !== "load") {
      return;
    }
    if (loadedState.requestKey === loadDescriptor.requestKey) {
      return;
    }

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;

    void loadEncryptedLane({
      token: loadDescriptor.token,
      chatId: loadDescriptor.chatId,
      activeCryptoDeviceId: loadDescriptor.activeCryptoDeviceId,
      cryptoRuntime,
    })
      .then((items) => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }

        setLoadedState({
          requestKey: loadDescriptor.requestKey,
          status: "ready",
          items,
          errorMessage: null,
        });
      })
      .catch((error) => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }

        setLoadedState({
          requestKey: loadDescriptor.requestKey,
          status: "error",
          items: [],
          errorMessage:
            error instanceof Error && error.message.trim() !== ""
              ? error.message
              : "Не удалось загрузить encrypted DM v2 local projection.",
        });
      });
  }, [
    cryptoRuntime,
    loadDescriptor,
    loadedState.requestKey,
  ]);

  useEffect(() => {
    if (loadDescriptor.kind !== "load") {
      return;
    }

    let cancelled = false;

    const unsubscribe = subscribeEncryptedDirectMessageV2RealtimeEvents((event) => {
      if (
        cancelled ||
        event.envelope.chatId !== loadDescriptor.chatId ||
        event.envelope.viewerDelivery.recipientCryptoDeviceId !==
          loadDescriptor.activeCryptoDeviceId
      ) {
        return;
      }

      discardBufferedLocalEncryptedDirectMessageV2Projection([
        {
          chatId: event.envelope.chatId,
          messageId: event.envelope.messageId,
          revision: event.envelope.revision,
        },
      ]);

      void cryptoRuntime
        .decryptEncryptedDirectMessageV2Envelopes([event.envelope])
        .then((updates) => {
          if (cancelled) {
            return;
          }

          setLoadedState((current) => ({
            requestKey: loadDescriptor.requestKey,
            status: "ready",
            items: mergeEncryptedDirectMessageV2Projection(current.items, updates),
            errorMessage: current.errorMessage,
          }));
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }

          setLoadedState((current) => ({
            ...current,
            requestKey: loadDescriptor.requestKey,
            status: "error",
            errorMessage:
              error instanceof Error && error.message.trim() !== ""
                ? error.message
                : "Не удалось локально обработать realtime encrypted envelope.",
          }));
        });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [cryptoRuntime, loadDescriptor]);

  useEffect(() => {
    if (loadDescriptor.kind !== "load") {
      return;
    }

    return subscribeLocalEncryptedDirectMessageV2Projection((event) => {
      if (event.projection.chatId !== loadDescriptor.chatId) {
        return;
      }

      setLoadedState((current) => ({
        requestKey: loadDescriptor.requestKey,
        status: "ready",
        items: mergeEncryptedDirectMessageV2Projection(current.items, [
          event.projection,
        ]),
        errorMessage: current.errorMessage,
      }));
    });
  }, [loadDescriptor]);

  if (loadDescriptor.kind === "idle") {
    return {
      status: "idle",
      items: [],
      errorMessage: null,
    };
  }

  if (loadDescriptor.kind === "unavailable") {
    return {
      status: "unavailable",
      items: [],
      errorMessage: loadDescriptor.errorMessage,
    };
  }

  if (loadDescriptor.kind === "loading") {
    return {
      status: "loading",
      items: [],
      errorMessage: null,
    };
  }

  if (loadedState.requestKey !== loadDescriptor.requestKey) {
    return {
      status: "loading",
      items: [],
      errorMessage: null,
    };
  }

  return {
    status: loadedState.status,
    items: loadedState.items,
    errorMessage: loadedState.errorMessage,
  };
}

async function loadEncryptedLane(input: {
  token: string;
  chatId: string;
  activeCryptoDeviceId: string;
  cryptoRuntime: ReturnType<typeof useCryptoRuntime>;
}): Promise<EncryptedDirectMessageV2ProjectionEntry[]> {
  const envelopes = await gatewayClient.listEncryptedDirectMessageV2(
    input.token,
    input.chatId,
    input.activeCryptoDeviceId,
    encryptedDirectMessageV2ProjectionLimit,
  );
  const buffered = listBufferedEncryptedDirectMessageV2RealtimeEvents()
    .map((event) => event.envelope)
    .filter(
      (envelope) =>
        envelope.chatId === input.chatId &&
        envelope.viewerDelivery.recipientCryptoDeviceId === input.activeCryptoDeviceId,
    );
  const mergedOpaqueEnvelopes = deduplicateEncryptedDirectMessageV2Envelopes([
    ...envelopes,
    ...buffered,
  ]);
  discardBufferedLocalEncryptedDirectMessageV2Projection(
    mergedOpaqueEnvelopes.map((envelope) => ({
      chatId: envelope.chatId,
      messageId: envelope.messageId,
      revision: envelope.revision,
    })),
  );
  const decrypted = await input.cryptoRuntime.decryptEncryptedDirectMessageV2Envelopes(
    mergedOpaqueEnvelopes,
  );
  const localOutbound = listBufferedLocalEncryptedDirectMessageV2Projection(
    input.chatId,
  );

  return mergeEncryptedDirectMessageV2Projection([], [
    ...decrypted,
    ...localOutbound,
  ]);
}

function deduplicateEncryptedDirectMessageV2Envelopes(
  envelopes: EncryptedDirectMessageV2Envelope[],
): EncryptedDirectMessageV2Envelope[] {
  const deduplicated = new Map<string, EncryptedDirectMessageV2Envelope>();
  for (const envelope of envelopes) {
    deduplicated.set(buildOpaqueEnvelopeKey(envelope), envelope);
  }

  return Array.from(deduplicated.values()).sort(compareOpaqueEnvelopes);
}

function buildOpaqueEnvelopeKey(envelope: EncryptedDirectMessageV2Envelope): string {
  return [
    envelope.messageId,
    envelope.revision,
    envelope.viewerDelivery.recipientCryptoDeviceId,
    envelope.storedAt,
  ].join(":");
}

function compareOpaqueEnvelopes(
  left: EncryptedDirectMessageV2Envelope,
  right: EncryptedDirectMessageV2Envelope,
): number {
  if (left.createdAt === right.createdAt) {
    return left.messageId.localeCompare(right.messageId);
  }

  return left.createdAt.localeCompare(right.createdAt);
}

export function describeEncryptedDirectMessageV2LaneEmptyState(
  itemCount: number,
): string {
  if (itemCount > 0) {
    return "";
  }

  return "Для текущего direct chat и текущего local crypto-device opaque encrypted envelopes пока не найдены. Legacy plaintext история остаётся ниже без скрытого merge.";
}

export { describeEncryptedDirectMessageV2Failure };

function resolveEncryptedLaneLoadDescriptor(input: {
  enabled: boolean;
  activeChatId: string;
  activeCryptoDeviceId: string | null;
  cryptoRuntimeState: ReturnType<typeof useCryptoRuntime>["state"];
  token: string;
}):
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "unavailable"; errorMessage: string }
  | {
      kind: "load";
      requestKey: string;
      token: string;
      chatId: string;
      activeCryptoDeviceId: string;
    } {
  if (!input.enabled || input.activeChatId === "") {
    return { kind: "idle" };
  }
  if (input.cryptoRuntimeState.status === "bootstrapping") {
    return { kind: "loading" };
  }

  const snapshot = input.cryptoRuntimeState.snapshot;
  if (snapshot === null) {
    return {
      kind: "unavailable",
      errorMessage: "Crypto runtime snapshot ещё не готов для encrypted DM v2 local projection.",
    };
  }
  if (snapshot.support !== "available" || snapshot.phase === "error") {
    return {
      kind: "unavailable",
      errorMessage:
        snapshot.errorMessage ??
        "Текущий browser profile не может расшифровывать encrypted DM v2 в этом slice.",
    };
  }
  if (input.activeCryptoDeviceId === null) {
    return {
      kind: "unavailable",
      errorMessage:
        snapshot.phase === "attention_required"
          ? "Для этого browser profile ещё нет active local crypto-device, поэтому encrypted DM v2 остаётся недоступен."
          : "Active local crypto-device не найден, поэтому encrypted DM v2 local projection недоступен.",
    };
  }

  return {
    kind: "load",
    requestKey: [
      input.token,
      input.activeChatId,
      input.activeCryptoDeviceId,
    ].join(":"),
    token: input.token,
    chatId: input.activeChatId,
    activeCryptoDeviceId: input.activeCryptoDeviceId,
  };
}
