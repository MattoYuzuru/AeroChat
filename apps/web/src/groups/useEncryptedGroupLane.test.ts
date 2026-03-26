import { describe, expect, it } from "vitest";
import { resolveEncryptedGroupLoadDescriptor } from "./useEncryptedGroupLane";
import type { CryptoContextState } from "../crypto/runtime-context";

describe("useEncryptedGroupLane helpers", () => {
  it("builds stable load descriptor from primitive token, group and crypto-device inputs", () => {
    const readyState = createReadyCryptoState("crypto-1");

    expect(
      resolveEncryptedGroupLoadDescriptor({
        enabled: true,
        activeGroupId: "group-1",
        activeCryptoDeviceId: "crypto-1",
        cryptoRuntimeState: readyState,
        token: "token-a",
      }),
    ).toEqual({
      kind: "load",
      requestKey: "token-a:group-1:crypto-1",
      token: "token-a",
      groupId: "group-1",
      activeCryptoDeviceId: "crypto-1",
    });

    expect(
      resolveEncryptedGroupLoadDescriptor({
        enabled: true,
        activeGroupId: "group-1",
        activeCryptoDeviceId: "crypto-1",
        cryptoRuntimeState: readyState,
        token: "token-b",
      }),
    ).toEqual({
      kind: "load",
      requestKey: "token-b:group-1:crypto-1",
      token: "token-b",
      groupId: "group-1",
      activeCryptoDeviceId: "crypto-1",
    });
  });

  it("marks lane unavailable when active crypto-device is missing after runtime bootstrap", () => {
    expect(
      resolveEncryptedGroupLoadDescriptor({
        enabled: true,
        activeGroupId: "group-1",
        activeCryptoDeviceId: null,
        cryptoRuntimeState: createReadyCryptoState(null),
        token: "token-a",
      }),
    ).toEqual({
      kind: "unavailable",
      errorMessage:
        "Active local crypto-device не найден, поэтому encrypted group local projection недоступен.",
    });
  });
});

function createReadyCryptoState(
  cryptoDeviceId: string | null,
): CryptoContextState {
  return {
    status: "ready",
    snapshot: {
      support: "available",
      phase: "ready",
      localDevice:
        cryptoDeviceId === null
          ? null
          : {
              version: 1,
              accountId: "user-1",
              login: "alice",
              cryptoDeviceId,
              deviceLabel: "Alice browser",
              cryptoSuite: "web-ed25519-foundation-v1",
              status: "active",
              signedPrekeyId: "spk-1",
              bundleDigestBase64: "digest",
              lastBundleVersion: 1,
              lastBundlePublishedAt: "2026-03-26T10:00:00Z",
              createdAt: "2026-03-26T10:00:00Z",
              updatedAt: "2026-03-26T10:00:00Z",
              linkIntentId: null,
              linkIntentExpiresAt: null,
            },
      devices: [],
      linkIntents: [],
      currentBundle: null,
      canCreatePendingDevice: false,
      canApproveLinkIntents: false,
      notice: null,
      errorMessage: null,
    },
    isActionPending: false,
    pendingLabel: null,
  };
}
