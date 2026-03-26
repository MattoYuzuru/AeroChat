import { useEffect, useRef, useState } from "react";
import { useCryptoRuntime } from "../crypto/useCryptoRuntime";
import { describeGatewayError, isGatewayErrorCode } from "../gateway/types";
import type { EncryptedGroupBootstrap } from "../gateway/types";
import { gatewayClient } from "../gateway/runtime";
import {
  parseBoundRealtimeCryptoDeviceId,
  resolveActiveRealtimeCryptoDeviceId,
} from "../crypto/realtime-bridge-helpers";
import type { EncryptedGroupEnvelope } from "../gateway/types";
import {
  describeEncryptedGroupFailure,
  encryptedGroupProjectionLimit,
  mergeEncryptedGroupProjection,
  type EncryptedGroupProjectionEntry,
} from "./encrypted-group-projection";
import {
  listBufferedEncryptedGroupRealtimeEvents,
  subscribeEncryptedGroupRealtimeEvents,
} from "./encrypted-group-realtime";
import {
  discardBufferedLocalEncryptedGroupProjection,
  listBufferedLocalEncryptedGroupProjection,
  subscribeLocalEncryptedGroupProjection,
} from "./encrypted-group-local-outbound";
import { subscribeRealtimeEnvelopes } from "../realtime/events";

interface UseEncryptedGroupLaneOptions {
  enabled: boolean;
  token: string;
  groupId: string | null;
  pageSize?: number;
}

export interface EncryptedGroupLaneState {
  status: "idle" | "loading" | "ready" | "unavailable" | "error";
  bootstrap: EncryptedGroupBootstrap | null;
  items: EncryptedGroupProjectionEntry[];
  errorMessage: string | null;
}

interface LoadedEncryptedGroupLaneState {
  requestKey: string | null;
  status: "ready" | "error" | "unavailable";
  bootstrap: EncryptedGroupBootstrap | null;
  items: EncryptedGroupProjectionEntry[];
  errorMessage: string | null;
}

export function useEncryptedGroupLane({
  enabled,
  token,
  groupId,
  pageSize = encryptedGroupProjectionLimit,
}: UseEncryptedGroupLaneOptions): EncryptedGroupLaneState {
  const cryptoRuntime = useCryptoRuntime();
  const activeCryptoDeviceId = resolveActiveRealtimeCryptoDeviceId(cryptoRuntime.state);
  const activeGroupId = groupId?.trim() ?? "";
  const [loadedState, setLoadedState] = useState<LoadedEncryptedGroupLaneState>({
    requestKey: null,
    status: "ready",
    bootstrap: null,
    items: [],
    errorMessage: null,
  });
  const requestVersionRef = useRef(0);
  const loadDescriptor = resolveEncryptedGroupLoadDescriptor({
    enabled,
    activeGroupId,
    activeCryptoDeviceId,
    cryptoRuntimeState: cryptoRuntime.state,
    pageSize,
    token,
  });
  const activeLoadRequestKey =
    loadDescriptor.kind === "load" ? loadDescriptor.requestKey : null;
  const activeLoadToken = loadDescriptor.kind === "load" ? loadDescriptor.token : null;
  const activeLoadGroupId = loadDescriptor.kind === "load" ? loadDescriptor.groupId : null;
  const activeLoadCryptoDeviceId =
    loadDescriptor.kind === "load" ? loadDescriptor.activeCryptoDeviceId : null;

  useEffect(() => {
    if (
      activeLoadRequestKey === null ||
      activeLoadToken === null ||
      activeLoadGroupId === null ||
      activeLoadCryptoDeviceId === null
    ) {
      return;
    }
    if (loadedState.requestKey === activeLoadRequestKey) {
      return;
    }

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;

    void loadEncryptedGroupLane({
      token: activeLoadToken,
      groupId: activeLoadGroupId,
      activeCryptoDeviceId: activeLoadCryptoDeviceId,
      cryptoRuntime,
      pageSize,
    })
      .then((result) => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }

        setLoadedState({
          requestKey: activeLoadRequestKey,
          status: "ready",
          bootstrap: result.bootstrap,
          items: result.items,
          errorMessage: null,
        });
      })
      .catch((error) => {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }

        const resolved = resolveEncryptedGroupLoadError(error);
        setLoadedState({
          requestKey: activeLoadRequestKey,
          status: resolved.kind,
          bootstrap: null,
          items: [],
          errorMessage: resolved.message,
        });
      });
  }, [
    cryptoRuntime,
    activeLoadCryptoDeviceId,
    activeLoadGroupId,
    activeLoadRequestKey,
    activeLoadToken,
    loadedState.requestKey,
    pageSize,
  ]);

  useEffect(() => {
    if (
      activeLoadRequestKey === null ||
      activeLoadGroupId === null ||
      activeLoadCryptoDeviceId === null
    ) {
      return;
    }

    let cancelled = false;

    const unsubscribe = subscribeEncryptedGroupRealtimeEvents((event) => {
      if (
        cancelled ||
        event.envelope.groupId !== activeLoadGroupId ||
        event.envelope.viewerDelivery.recipientCryptoDeviceId !==
          activeLoadCryptoDeviceId
      ) {
        return;
      }

      discardBufferedLocalEncryptedGroupProjection([
        {
          groupId: event.envelope.groupId,
          messageId: event.envelope.messageId,
          revision: event.envelope.revision,
        },
      ]);

      void cryptoRuntime
        .decryptEncryptedGroupEnvelopes([event.envelope])
        .then((updates) => {
          if (cancelled) {
            return;
          }

          setLoadedState((current) => ({
            requestKey: activeLoadRequestKey,
            status: "ready",
            bootstrap: current.bootstrap,
            items: mergeEncryptedGroupProjection(current.items, updates),
            errorMessage: current.errorMessage,
          }));
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }

          setLoadedState((current) => ({
            ...current,
            requestKey: activeLoadRequestKey,
            status: "error",
            errorMessage:
              error instanceof Error && error.message.trim() !== ""
                ? error.message
                : "Не удалось локально обработать realtime encrypted group envelope.",
          }));
        });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [
    cryptoRuntime,
    activeLoadCryptoDeviceId,
    activeLoadGroupId,
    activeLoadRequestKey,
  ]);

  useEffect(() => {
    if (
      activeLoadRequestKey === null ||
      activeLoadToken === null ||
      activeLoadGroupId === null ||
      activeLoadCryptoDeviceId === null
    ) {
      return;
    }

    return subscribeRealtimeEnvelopes((envelope) => {
      const boundCryptoDeviceId = parseBoundRealtimeCryptoDeviceId(envelope);
      if (
        boundCryptoDeviceId === null ||
        boundCryptoDeviceId !== activeLoadCryptoDeviceId
      ) {
        return;
      }

      const requestVersion = requestVersionRef.current + 1;
      requestVersionRef.current = requestVersion;

      void loadEncryptedGroupLane({
        token: activeLoadToken,
        groupId: activeLoadGroupId,
        activeCryptoDeviceId: activeLoadCryptoDeviceId,
        cryptoRuntime,
        pageSize,
      })
        .then((result) => {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }

          setLoadedState({
            requestKey: activeLoadRequestKey,
            status: "ready",
            bootstrap: result.bootstrap,
            items: result.items,
            errorMessage: null,
          });
        })
        .catch((error) => {
          if (requestVersionRef.current !== requestVersion) {
            return;
          }

          setLoadedState((current) => ({
            requestKey: activeLoadRequestKey,
            status: "error",
            bootstrap:
              current.requestKey === activeLoadRequestKey ? current.bootstrap : null,
            items: current.requestKey === activeLoadRequestKey ? current.items : [],
            errorMessage:
              error instanceof Error && error.message.trim() !== ""
                ? error.message
                : "Не удалось перечитать encrypted group local projection после reconnect.",
          }));
        });
    });
  }, [
    cryptoRuntime,
    activeLoadCryptoDeviceId,
    activeLoadGroupId,
    activeLoadRequestKey,
    activeLoadToken,
    pageSize,
  ]);

  useEffect(() => {
    if (activeLoadRequestKey === null || activeLoadGroupId === null) {
      return;
    }

    return subscribeLocalEncryptedGroupProjection((event) => {
      if (event.projection.groupId !== activeLoadGroupId) {
        return;
      }

      setLoadedState((current) => ({
        requestKey: activeLoadRequestKey,
        status: "ready",
        bootstrap: current.bootstrap,
        items: mergeEncryptedGroupProjection(current.items, [event.projection]),
        errorMessage: current.errorMessage,
      }));
    });
  }, [activeLoadGroupId, activeLoadRequestKey]);

  if (loadDescriptor.kind === "idle") {
    return {
      status: "idle",
      bootstrap: null,
      items: [],
      errorMessage: null,
    };
  }

  if (loadDescriptor.kind === "unavailable") {
    return {
      status: "unavailable",
      bootstrap: null,
      items: [],
      errorMessage: loadDescriptor.errorMessage,
    };
  }

  if (loadDescriptor.kind === "loading") {
    return {
      status: "loading",
      bootstrap: null,
      items: [],
      errorMessage: null,
    };
  }

  if (loadedState.requestKey !== loadDescriptor.requestKey) {
    return {
      status: "loading",
      bootstrap: null,
      items: [],
      errorMessage: null,
    };
  }

  return {
    status: loadedState.status,
    bootstrap: loadedState.bootstrap,
    items: loadedState.items,
    errorMessage: loadedState.errorMessage,
  };
}

async function loadEncryptedGroupLane(input: {
  token: string;
  groupId: string;
  activeCryptoDeviceId: string;
  cryptoRuntime: ReturnType<typeof useCryptoRuntime>;
  pageSize: number;
}): Promise<{
  bootstrap: EncryptedGroupBootstrap;
  items: EncryptedGroupProjectionEntry[];
}> {
  const bootstrap = await gatewayClient.getEncryptedGroupBootstrap(
    input.token,
    input.groupId,
    input.activeCryptoDeviceId,
  );
  const envelopes = await gatewayClient.listEncryptedGroupMessages(
    input.token,
    input.groupId,
    input.activeCryptoDeviceId,
    input.pageSize,
  );
  const buffered = listBufferedEncryptedGroupRealtimeEvents()
    .map((event) => event.envelope)
    .filter(
      (envelope) =>
        envelope.groupId === input.groupId &&
        envelope.viewerDelivery.recipientCryptoDeviceId === input.activeCryptoDeviceId,
    );
  const mergedOpaqueEnvelopes = deduplicateEncryptedGroupEnvelopes([
    ...envelopes,
    ...buffered,
  ]);
  discardBufferedLocalEncryptedGroupProjection(
    mergedOpaqueEnvelopes.map((envelope) => ({
      groupId: envelope.groupId,
      messageId: envelope.messageId,
      revision: envelope.revision,
    })),
  );
  const updates = await input.cryptoRuntime.decryptEncryptedGroupEnvelopes(
    mergedOpaqueEnvelopes,
  );
  const localOutbound = listBufferedLocalEncryptedGroupProjection(input.groupId);

  return {
    bootstrap,
    items: mergeEncryptedGroupProjection([], [...updates, ...localOutbound], input.pageSize),
  };
}

function deduplicateEncryptedGroupEnvelopes(
  envelopes: EncryptedGroupEnvelope[],
): EncryptedGroupEnvelope[] {
  const unique = new Map<string, EncryptedGroupEnvelope>();
  for (const envelope of envelopes) {
    const existing = unique.get(envelope.messageId);
    if (existing === undefined || existing.revision <= envelope.revision) {
      unique.set(envelope.messageId, envelope);
    }
  }

  return Array.from(unique.values()).sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export function resolveEncryptedGroupLoadDescriptor(input: {
  enabled: boolean;
  activeGroupId: string;
  activeCryptoDeviceId: string | null;
  cryptoRuntimeState: ReturnType<typeof useCryptoRuntime>["state"];
  pageSize?: number;
  token: string;
}):
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "unavailable"; errorMessage: string }
  | {
    kind: "load";
    requestKey: string;
    token: string;
      groupId: string;
      activeCryptoDeviceId: string;
    } {
  if (!input.enabled || input.activeGroupId === "" || input.token.trim() === "") {
    return { kind: "idle" };
  }

  if (input.cryptoRuntimeState.status === "disabled") {
    return {
      kind: "unavailable",
      errorMessage: "Crypto runtime foundation отключён, поэтому encrypted group lane недоступен.",
    };
  }

  if (input.cryptoRuntimeState.status === "bootstrapping") {
    return { kind: "loading" };
  }

  if (input.activeCryptoDeviceId === null) {
    return {
      kind: "unavailable",
      errorMessage:
        "Active local crypto-device не найден, поэтому encrypted group local projection недоступен.",
    };
  }

  return {
    kind: "load",
    requestKey: [
      input.token,
      input.activeGroupId,
      input.activeCryptoDeviceId,
      Math.max(1, Math.trunc(input.pageSize ?? encryptedGroupProjectionLimit)),
    ].join(":"),
    token: input.token,
    groupId: input.activeGroupId,
    activeCryptoDeviceId: input.activeCryptoDeviceId,
  };
}

function resolveEncryptedGroupLoadError(
  error: unknown,
): {
  kind: "unavailable" | "error";
  message: string;
} {
  if (
    isGatewayErrorCode(error, "failed_precondition") ||
    isGatewayErrorCode(error, "permission_denied") ||
    isGatewayErrorCode(error, "not_found")
  ) {
    return {
      kind: "unavailable",
      message: describeGatewayError(
        error,
        "Encrypted group lane пока недоступен для текущей группы и local crypto-device.",
      ),
    };
  }

  return {
    kind: "error",
    message: describeGatewayError(
      error,
      "Не удалось загрузить encrypted group local projection.",
    ),
  };
}

export function describeEncryptedGroupLaneIssue(
  entry: EncryptedGroupProjectionEntry,
): string | null {
  if (entry.kind !== "failure") {
    return null;
  }

  return describeEncryptedGroupFailure(entry);
}
