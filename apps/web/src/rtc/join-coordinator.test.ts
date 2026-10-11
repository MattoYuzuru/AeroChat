import { describe, expect, it } from "vitest";
import { createDirectCallJoinCoordinator } from "./join-coordinator";

describe("provider-owned direct call join leases", () => {
  it("serializes one user across remounts while isolating accounts and lease owners", () => {
    const coordinator = createDirectCallJoinCoordinator();
    const first = coordinator.acquire("a", "call-1").lease;
    expect(first).not.toBeNull();
    expect(coordinator.acquire("a", "call-1").lease).toBeNull();
    const other = coordinator.acquire("b", "call-1").lease;
    expect(other).not.toBeNull();
    first?.release();
    const next = coordinator.acquire("a", "call-1").lease;
    first?.release();
    expect(coordinator.acquire("a", "call-1").lease).toBeNull();
    next?.release();
    other?.release();
    expect(coordinator.acquire("a", "call-1").lease).not.toBeNull();
  });

  it("blocks uncertain same-call compensation until a fresh authoritative inactive snapshot", () => {
    const coordinator = createDirectCallJoinCoordinator();
    const lease = coordinator.acquire("a", "call-1").lease;
    const staleObservation = coordinator.observationVersion();
    lease?.markUncertain("chat-1", "call-1");
    lease?.release();
    expect(coordinator.acquire("a", "call-1").lease).toBeNull();
    coordinator.observeChat("chat-1", null, staleObservation);
    expect(coordinator.acquire("a", "call-1").lease).toBeNull();
    coordinator.observeChat("chat-1", "call-1", coordinator.observationVersion());
    expect(coordinator.acquire("a", "call-1").lease).toBeNull();
    const differentCall = coordinator.acquire("a", "call-2").lease;
    expect(differentCall).not.toBeNull();
    differentCall?.release();
    coordinator.observeChat("chat-1", null, coordinator.observationVersion());
    expect(coordinator.acquire("a", "call-1").lease).not.toBeNull();
  });
});
