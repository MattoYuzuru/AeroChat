import { describe, expect, it } from "vitest";
import {
  getViewportDistanceFromBottom,
  isViewportPinnedToBottom,
  resolveViewportScrollTopForPrependedHistory,
  scheduleThreadViewportBottomAlignment,
  shouldScrollThreadViewportToBottom,
  threadViewportBottomAlignmentDelayMs,
  threadViewportBottomAlignmentSettleDelayMs,
} from "./thread-viewport";

describe("thread viewport helpers", () => {
  it("treats a viewport near the lower edge as pinned to the latest message", () => {
    expect(
      isViewportPinnedToBottom({
        clientHeight: 320,
        scrollHeight: 1000,
        scrollTop: 620,
      }),
    ).toBe(true);

    expect(
      isViewportPinnedToBottom({
        clientHeight: 320,
        scrollHeight: 1000,
        scrollTop: 540,
      }),
    ).toBe(false);
  });

  it("measures the remaining distance to the last message", () => {
    expect(
      getViewportDistanceFromBottom({
        clientHeight: 300,
        scrollHeight: 1200,
        scrollTop: 860,
      }),
    ).toBe(40);
  });

  it("restores scroll position after prepending older history above the visible window", () => {
    expect(
      resolveViewportScrollTopForPrependedHistory({
        previousScrollHeight: 1200,
        previousScrollTop: 380,
        scrollHeight: 1560,
      }),
    ).toBe(740);
  });

  it("scrolls to the bottom on thread change or when the user kept the viewport pinned", () => {
    expect(
      shouldScrollThreadViewportToBottom({
        keepPinnedToBottom: false,
        olderHistoryAnchor: null,
        threadChanged: true,
      }),
    ).toBe(true);

    expect(
      shouldScrollThreadViewportToBottom({
        keepPinnedToBottom: true,
        olderHistoryAnchor: null,
        threadChanged: false,
      }),
    ).toBe(true);

    expect(
      shouldScrollThreadViewportToBottom({
        keepPinnedToBottom: true,
        olderHistoryAnchor: {
          previousScrollHeight: 1200,
          previousScrollTop: 380,
        },
        threadChanged: true,
      }),
    ).toBe(false);
  });

  it("retries bottom alignment before completing the reveal callback", () => {
    const scheduler = createThreadViewportTestScheduler();
    let scrollAssignments = 0;
    const viewport = createMutableViewport(() => {
      scrollAssignments += 1;
    });
    const keepPinnedToBottomRef = { current: false };
    let completed = 0;

    scheduleThreadViewportBottomAlignment({
      keepPinnedToBottomRef,
      onComplete: () => {
        completed += 1;
      },
      scheduler: scheduler.scheduler,
      viewport,
    });

    expect(scrollAssignments).toBe(1);
    expect(viewport.scrollTop).toBe(viewport.scrollHeight);
    expect(keepPinnedToBottomRef.current).toBe(true);
    expect(completed).toBe(0);

    scheduler.runAnimationFrameBatch();
    expect(scrollAssignments).toBe(2);
    expect(completed).toBe(0);

    scheduler.runAnimationFrameBatch();
    expect(scrollAssignments).toBe(3);
    expect(completed).toBe(0);

    scheduler.runTimeout(threadViewportBottomAlignmentDelayMs);
    expect(scrollAssignments).toBe(4);
    expect(completed).toBe(0);

    scheduler.runTimeout(threadViewportBottomAlignmentSettleDelayMs);
    expect(scrollAssignments).toBe(5);
    expect(completed).toBe(1);
  });

  it("cancels pending completion when the alignment scope is disposed", () => {
    const scheduler = createThreadViewportTestScheduler();
    const viewport = createMutableViewport();
    let completed = 0;

    const cancelAlignment = scheduleThreadViewportBottomAlignment({
      onComplete: () => {
        completed += 1;
      },
      scheduler: scheduler.scheduler,
      viewport,
    });

    cancelAlignment();
    scheduler.runAll();

    expect(completed).toBe(0);
  });
});

function createMutableViewport(onScrollTopAssigned?: () => void) {
  let scrollTop = 0;

  return {
    clientHeight: 320,
    scrollHeight: 1000,
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(nextValue: number) {
      scrollTop = nextValue;
      onScrollTopAssigned?.();
    },
  };
}

function createThreadViewportTestScheduler() {
  let nextID = 1;
  const animationFrames = new Map<number, () => void>();
  const timeouts = new Map<number, { callback: () => void; delayMs: number }>();

  return {
    scheduler: {
      cancelAnimationFrame(id: number) {
        animationFrames.delete(id);
      },
      clearTimeout(id: number) {
        timeouts.delete(id);
      },
      requestAnimationFrame(callback: () => void) {
        const id = nextID;
        nextID += 1;
        animationFrames.set(id, callback);
        return id;
      },
      setTimeout(callback: () => void, delayMs: number) {
        const id = nextID;
        nextID += 1;
        timeouts.set(id, { callback, delayMs });
        return id;
      },
    },
    runAll() {
      while (animationFrames.size > 0 || timeouts.size > 0) {
        this.runAnimationFrameBatch();
        const nextTimeoutDelay = [...timeouts.values()]
          .map((entry) => entry.delayMs)
          .sort((left, right) => left - right)[0];
        if (nextTimeoutDelay !== undefined) {
          this.runTimeout(nextTimeoutDelay);
        }
      }
    },
    runAnimationFrameBatch() {
      const currentBatch = [...animationFrames.entries()];
      animationFrames.clear();
      currentBatch.forEach(([, callback]) => {
        callback();
      });
    },
    runTimeout(delayMs: number) {
      const matchingTimeouts = [...timeouts.entries()].filter(
        ([, entry]) => entry.delayMs === delayMs,
      );
      matchingTimeouts.forEach(([id]) => {
        timeouts.delete(id);
      });
      matchingTimeouts.forEach(([, entry]) => {
        entry.callback();
      });
    },
  };
}
