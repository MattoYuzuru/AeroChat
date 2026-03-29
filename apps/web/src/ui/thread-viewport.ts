import {
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
  type RefObject,
} from "react";

export interface ThreadViewportOlderHistoryAnchor {
  previousScrollHeight: number;
  previousScrollTop: number;
}

interface ThreadViewportMetrics {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}

interface MutableThreadViewportMetrics extends ThreadViewportMetrics {
  scrollTop: number;
}

interface UseThreadViewportAutoPinInput {
  contentRef: RefObject<HTMLElement | null>;
  enabled?: boolean;
  keepPinnedToBottomRef: MutableRefObject<boolean>;
  layoutVersion: number | string;
  olderHistoryAnchorRef?: MutableRefObject<ThreadViewportOlderHistoryAnchor | null>;
  threadKey: string | null;
  viewportRef: RefObject<HTMLElement | null>;
}

export const threadViewportBottomThresholdPx = 64;
export const threadViewportBottomAlignmentDelayMs = 96;
export const threadViewportBottomAlignmentSettleDelayMs = 220;

export interface ThreadViewportBottomAlignmentScheduler {
  cancelAnimationFrame: (id: number) => void;
  clearTimeout: (id: number) => void;
  requestAnimationFrame: (callback: () => void) => number;
  setTimeout: (callback: () => void, delayMs: number) => number;
}

export function getViewportDistanceFromBottom(input: ThreadViewportMetrics): number {
  return input.scrollHeight - input.scrollTop - input.clientHeight;
}

export function scrollThreadViewportToBottom(input: MutableThreadViewportMetrics): void {
  input.scrollTop = input.scrollHeight;
}

export function isViewportPinnedToBottom(
  input: ThreadViewportMetrics,
  thresholdPx = threadViewportBottomThresholdPx,
): boolean {
  return getViewportDistanceFromBottom(input) < thresholdPx;
}

export function resolveViewportScrollTopForPrependedHistory(
  input: Pick<ThreadViewportMetrics, "scrollHeight"> & {
    previousScrollHeight: number;
    previousScrollTop: number;
  },
): number {
  return Math.max(
    0,
    input.scrollHeight - input.previousScrollHeight + input.previousScrollTop,
  );
}

export function shouldScrollThreadViewportToBottom(input: {
  keepPinnedToBottom: boolean;
  olderHistoryAnchor: ThreadViewportOlderHistoryAnchor | null;
  threadChanged: boolean;
}): boolean {
  if (input.olderHistoryAnchor !== null) {
    return false;
  }

  return input.threadChanged || input.keepPinnedToBottom;
}

function resolveThreadViewportBottomAlignmentScheduler():
  | ThreadViewportBottomAlignmentScheduler
  | null {
  if (typeof window === "undefined") {
    return null;
  }

  return {
    cancelAnimationFrame: (id) => {
      window.cancelAnimationFrame(id);
    },
    clearTimeout: (id) => {
      window.clearTimeout(id);
    },
    requestAnimationFrame: (callback) => window.requestAnimationFrame(() => callback()),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  };
}

export function scheduleThreadViewportBottomAlignment(input: {
  keepPinnedToBottomRef?: MutableRefObject<boolean> | { current: boolean };
  onComplete?: () => void;
  scheduler?: ThreadViewportBottomAlignmentScheduler;
  viewport: MutableThreadViewportMetrics;
}): () => void {
  const scheduler = input.scheduler ?? resolveThreadViewportBottomAlignmentScheduler();
  let completed = false;
  let cancelled = false;

  const alignToBottom = () => {
    scrollThreadViewportToBottom(input.viewport);
    if (input.keepPinnedToBottomRef !== undefined) {
      input.keepPinnedToBottomRef.current = true;
    }
  };
  const complete = () => {
    if (completed || cancelled) {
      return;
    }

    completed = true;
    input.onComplete?.();
  };

  alignToBottom();

  if (scheduler === null) {
    complete();
    return () => undefined;
  }

  const animationFrameIDs: number[] = [];
  const timeoutIDs: number[] = [];

  animationFrameIDs.push(
    scheduler.requestAnimationFrame(() => {
      alignToBottom();
      animationFrameIDs.push(
        scheduler.requestAnimationFrame(() => {
          alignToBottom();
        }),
      );
    }),
  );
  timeoutIDs.push(
    scheduler.setTimeout(() => {
      alignToBottom();
    }, threadViewportBottomAlignmentDelayMs),
  );
  timeoutIDs.push(
    scheduler.setTimeout(() => {
      alignToBottom();
      complete();
    }, threadViewportBottomAlignmentSettleDelayMs),
  );

  return () => {
    if (completed || cancelled) {
      return;
    }

    cancelled = true;
    animationFrameIDs.forEach((id) => {
      scheduler.cancelAnimationFrame(id);
    });
    timeoutIDs.forEach((id) => {
      scheduler.clearTimeout(id);
    });
  };
}

export function useThreadViewportAutoPin({
  contentRef,
  enabled = true,
  keepPinnedToBottomRef,
  layoutVersion,
  olderHistoryAnchorRef,
  threadKey,
  viewportRef,
}: UseThreadViewportAutoPinInput) {
  const previousThreadKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }

    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }

    const threadChanged = previousThreadKeyRef.current !== threadKey;
    const olderHistoryAnchor = olderHistoryAnchorRef?.current ?? null;

    if (olderHistoryAnchor !== null) {
      viewport.scrollTop = resolveViewportScrollTopForPrependedHistory({
        previousScrollHeight: olderHistoryAnchor.previousScrollHeight,
        previousScrollTop: olderHistoryAnchor.previousScrollTop,
        scrollHeight: viewport.scrollHeight,
      });
      if (olderHistoryAnchorRef !== undefined) {
        olderHistoryAnchorRef.current = null;
      }
    } else if (
      shouldScrollThreadViewportToBottom({
        keepPinnedToBottom: keepPinnedToBottomRef.current,
        olderHistoryAnchor,
        threadChanged,
      })
    ) {
      const cancelBottomAlignment = scheduleThreadViewportBottomAlignment({
        keepPinnedToBottomRef,
        viewport,
      });
      previousThreadKeyRef.current = threadKey;

      return () => {
        cancelBottomAlignment();
      };
    }

    previousThreadKeyRef.current = threadKey;

    return undefined;
  }, [enabled, keepPinnedToBottomRef, layoutVersion, olderHistoryAnchorRef, threadKey, viewportRef]);

  useEffect(() => {
    if (!enabled || typeof ResizeObserver === "undefined") {
      return;
    }

    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (viewport === null || content === null) {
      return;
    }

    let animationFrameID = 0;

    const scheduleScrollToBottom = () => {
      if (!keepPinnedToBottomRef.current) {
        return;
      }

      if (animationFrameID !== 0) {
        window.cancelAnimationFrame(animationFrameID);
      }

      animationFrameID = window.requestAnimationFrame(() => {
        scrollThreadViewportToBottom(viewport);
      });
    };

    const observer = new ResizeObserver(() => {
      scheduleScrollToBottom();
    });

    observer.observe(content);
    observer.observe(viewport);

    return () => {
      observer.disconnect();
      if (animationFrameID !== 0) {
        window.cancelAnimationFrame(animationFrameID);
      }
    };
  }, [contentRef, enabled, keepPinnedToBottomRef, threadKey, viewportRef]);
}
