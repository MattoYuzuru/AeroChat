import { describe, expect, it } from "vitest";
import { runKeyedQueuedRefresh, runQueuedRefresh } from "./refresh";

describe("rtc refresh queue helpers", () => {
  it("replays one more full refresh when another request arrives mid-flight", async () => {
    const controller = {
      inFlight: null as Promise<void> | null,
      queued: false,
    };
    const releaseOrder: Array<() => void> = [];
    let runs = 0;

    const task = () =>
      new Promise<void>((resolve) => {
        runs += 1;
        releaseOrder.push(resolve);
      });

    const firstRun = runQueuedRefresh(controller, task);
    await Promise.resolve();
    const secondRun = runQueuedRefresh(controller, task);
    await Promise.resolve();

    expect(runs).toBe(1);

    releaseOrder.shift()?.();
    await Promise.resolve();

    expect(runs).toBe(2);

    releaseOrder.shift()?.();
    await Promise.all([firstRun, secondRun]);
    expect(controller.inFlight).toBeNull();
  });

  it("coalesces multiple overlapping full refresh requests into one replay", async () => {
    const controller = {
      inFlight: null as Promise<void> | null,
      queued: false,
    };
    const releaseOrder: Array<() => void> = [];
    let runs = 0;

    const task = () =>
      new Promise<void>((resolve) => {
        runs += 1;
        releaseOrder.push(resolve);
      });

    const firstRun = runQueuedRefresh(controller, task);
    await Promise.resolve();
    const secondRun = runQueuedRefresh(controller, task);
    const thirdRun = runQueuedRefresh(controller, task);
    await Promise.resolve();

    expect(runs).toBe(1);

    releaseOrder.shift()?.();
    await Promise.resolve();
    expect(runs).toBe(2);

    releaseOrder.shift()?.();
    await Promise.all([firstRun, secondRun, thirdRun]);
    expect(runs).toBe(2);
  });

  it("replays only the affected keyed refresh when the same chat is requested again", async () => {
    const inFlightByKey = new Map<string, Promise<void>>();
    const queuedKeys = new Set<string>();
    const releaseByKey = new Map<string, Array<() => void>>();
    const runsByKey = new Map<string, number>();

    const task = (key: string) =>
      new Promise<void>((resolve) => {
        runsByKey.set(key, (runsByKey.get(key) ?? 0) + 1);
        const queued = releaseByKey.get(key) ?? [];
        queued.push(resolve);
        releaseByKey.set(key, queued);
      });

    const firstChatRun = runKeyedQueuedRefresh(
      inFlightByKey,
      queuedKeys,
      "chat-1",
      () => task("chat-1"),
    );
    const secondChatRun = runKeyedQueuedRefresh(
      inFlightByKey,
      queuedKeys,
      "chat-1",
      () => task("chat-1"),
    );
    const otherChatRun = runKeyedQueuedRefresh(
      inFlightByKey,
      queuedKeys,
      "chat-2",
      () => task("chat-2"),
    );
    await Promise.resolve();

    expect(runsByKey.get("chat-1")).toBe(1);
    expect(runsByKey.get("chat-2")).toBe(1);

    releaseByKey.get("chat-1")?.shift()?.();
    releaseByKey.get("chat-2")?.shift()?.();
    await Promise.resolve();

    expect(runsByKey.get("chat-1")).toBe(2);
    expect(runsByKey.get("chat-2")).toBe(1);

    releaseByKey.get("chat-1")?.shift()?.();
    await Promise.all([firstChatRun, secondChatRun, otherChatRun]);
    expect(inFlightByKey.size).toBe(0);
  });
});
