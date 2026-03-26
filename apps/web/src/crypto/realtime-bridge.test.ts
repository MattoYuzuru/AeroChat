import { describe, expect, it } from "vitest";
import {
  buildBindCryptoDeviceRealtimeEnvelope,
  parseBoundRealtimeCryptoDeviceId,
  resolveActiveRealtimeCryptoDeviceId,
} from "./realtime-bridge-helpers";

describe("crypto realtime bridge helpers", () => {
  it("builds explicit bind envelope for crypto device", () => {
    expect(buildBindCryptoDeviceRealtimeEnvelope("crypto-1")).toEqual({
      type: "connection.bind_crypto_device",
      payload: {
        cryptoDeviceId: "crypto-1",
      },
    });
  });

  it("resolves only active local crypto device for realtime binding", () => {
    expect(
      resolveActiveRealtimeCryptoDeviceId({
        status: "ready",
        snapshot: {
          support: "available",
          phase: "ready",
          localDevice: {
            version: 1,
            accountId: "user-1",
            login: "alice",
            cryptoDeviceId: "crypto-1",
            deviceLabel: "Alice browser",
            cryptoSuite: "web-ed25519-foundation-v1",
            status: "active",
            signedPrekeyId: "spk-1",
            bundleDigestBase64: "digest",
            lastBundleVersion: 1,
            lastBundlePublishedAt: "2026-03-22T10:00:00Z",
            createdAt: "2026-03-22T10:00:00Z",
            updatedAt: "2026-03-22T10:00:00Z",
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
      }),
    ).toBe("crypto-1");

    expect(
      resolveActiveRealtimeCryptoDeviceId({
        status: "ready",
        snapshot: {
          support: "available",
          phase: "ready",
          localDevice: {
            version: 1,
            accountId: "user-1",
            login: "alice",
            cryptoDeviceId: "crypto-2",
            deviceLabel: "Alice browser",
            cryptoSuite: "web-ed25519-foundation-v1",
            status: "pending_link",
            signedPrekeyId: "spk-1",
            bundleDigestBase64: "digest",
            lastBundleVersion: 1,
            lastBundlePublishedAt: null,
            createdAt: "2026-03-22T10:00:00Z",
            updatedAt: "2026-03-22T10:00:00Z",
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
      }),
    ).toBeNull();
  });

  it("parses bound crypto-device ack from realtime envelope", () => {
    expect(
      parseBoundRealtimeCryptoDeviceId({
        id: "evt-1",
        type: "connection.crypto_device.bound",
        issuedAt: "2026-03-26T10:00:00Z",
        payload: {
          connectionId: "conn-1",
          userId: "user-1",
          cryptoDeviceId: "crypto-1",
        },
      }),
    ).toBe("crypto-1");

    expect(
      parseBoundRealtimeCryptoDeviceId({
        id: "evt-2",
        type: "connection.ready",
        issuedAt: "2026-03-26T10:00:01Z",
        payload: {
          cryptoDeviceId: "crypto-1",
        },
      }),
    ).toBeNull();
  });
});
