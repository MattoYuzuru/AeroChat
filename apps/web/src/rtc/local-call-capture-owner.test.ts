import { describe, expect, it, vi } from "vitest";
import {
  createLocalCallCaptureOwner,
  type LocalCallCaptureScope,
} from "./local-call-capture-owner";

const scope = (extra: Partial<LocalCallCaptureScope> = {}): LocalCallCaptureScope => ({
  kind: "direct",
  userId: "user-a",
  authEpoch: Symbol(),
  scopeId: "chat-a",
  generation: 1,
  ...extra,
});

describe("app-local call capture ownership", () => {
  it("excludes another call, kind and account in one app instance", () => {
    const owner = createLocalCallCaptureOwner();
    const first = owner.acquire(scope()).lease!;
    expect(owner.acquire(scope({ kind: "group", scopeId: "group-b" })).lease).toBeNull();
    expect(owner.acquire(scope({ userId: "user-b" })).lease).toBeNull();
    expect(owner.getSnapshot()).toEqual({ kind: "direct", phase: "capture_pending" });
    first.release();
    expect(owner.getSnapshot()?.phase).toBe("closing");
    first.settle();
    expect(owner.acquire(scope({ kind: "group", userId: "user-b" })).lease).not.toBeNull();
  });

  it("retains active capture after pending join flow settles", () => {
    const owner = createLocalCallCaptureOwner();
    const lease = owner.acquire(scope()).lease!;
    expect(lease.retain()).toBe(true);
    lease.settle();
    expect(owner.getSnapshot()).toEqual({ kind: "direct", phase: "retained" });
    expect(owner.acquire(scope({ generation: 2 })).lease).toBeNull();
    lease.close();
    expect(lease.retain()).toBe(false);
    lease.release();
    expect(owner.getSnapshot()).toBeNull();
  });

  it("keeps cancelled permission reserved until late settlement", () => {
    const owner = createLocalCallCaptureOwner();
    const lease = owner.acquire(scope()).lease!;
    lease.close();
    lease.release();
    expect(owner.acquire(scope({ authEpoch: Symbol(), generation: 2 })).lease).toBeNull();
    expect(lease.retain()).toBe(false);
    lease.settle();
    expect(owner.getSnapshot()).toBeNull();
  });

  it("does not release closed capture until its owner confirms local cleanup", () => {
    const owner = createLocalCallCaptureOwner();
    const lease = owner.acquire(scope({ kind: "group" })).lease!;
    lease.retain();
    lease.close();
    lease.settle();
    expect(owner.getSnapshot()).toEqual({ kind: "group", phase: "closing" });
    lease.release();
    expect(owner.getSnapshot()).toBeNull();
  });

  it("isolates old release, close, retain and settlement from a new owner", () => {
    const owner = createLocalCallCaptureOwner();
    const old = owner.acquire(scope()).lease!;
    old.release();
    old.settle();
    const current = owner.acquire(scope({ generation: 2 })).lease!;
    current.retain();
    const snapshot = owner.getSnapshot();
    old.close();
    old.release();
    old.settle();
    expect(old.retain()).toBe(false);
    expect(old.isCurrent()).toBe(false);
    expect(current.isCurrent()).toBe(true);
    expect(owner.getSnapshot()).toBe(snapshot);
  });

  it("notifies all subscribers and removes only the requested subscription", () => {
    const owner = createLocalCallCaptureOwner();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = owner.subscribe(first);
    owner.subscribe(second);
    const lease = owner.acquire(scope()).lease!;
    lease.retain();
    lease.retain();
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
    unsubscribe();
    lease.close();
    lease.release();
    lease.settle();
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(4);
    expect(owner.getSnapshot()).toBeNull();
  });

  it("keeps stable snapshots and immutable opaque scope without bearer fields", () => {
    const owner = createLocalCallCaptureOwner();
    const input = scope();
    const lease = owner.acquire(input).lease!;
    input.kind = "group";
    input.userId = "changed";
    const snapshot = owner.getSnapshot();
    expect(owner.getSnapshot()).toBe(snapshot);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(lease.scope)).toBe(true);
    expect(lease.scope.kind).toBe("direct");
    expect(lease.scope.userId).toBe("user-a");
    expect(typeof lease.scope.authEpoch).toBe("symbol");
    expect(Object.keys(lease.scope).sort()).toEqual(["authEpoch", "generation", "kind", "scopeId", "userId"]);
    lease.retain();
    expect(owner.getSnapshot()?.kind).toBe("direct");
  });

  it("does not confuse separate app instances with server-wide admission", () => {
    const a = createLocalCallCaptureOwner();
    const b = createLocalCallCaptureOwner();
    expect(a.acquire(scope()).lease).not.toBeNull();
    expect(b.acquire(scope()).lease).not.toBeNull();
  });

  it.each([0, -1, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    "rejects invalid local generation %s without consuming a slot", (generation) => {
      const owner = createLocalCallCaptureOwner();
      expect(owner.acquire(scope({ generation })).lease).toBeNull();
      expect(owner.getSnapshot()).toBeNull();
      expect(owner.acquire(scope()).lease).not.toBeNull();
    },
  );

  it.each([{ userId: " " }, { scopeId: "" }])(
    "rejects incomplete local scope %j", (extra) => {
      const owner = createLocalCallCaptureOwner();
      expect(owner.acquire(scope(extra)).lease).toBeNull();
      expect(owner.getSnapshot()).toBeNull();
    },
  );
});
