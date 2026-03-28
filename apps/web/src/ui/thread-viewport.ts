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

export function getViewportDistanceFromBottom(input: ThreadViewportMetrics): number {
  return input.scrollHeight - input.scrollTop - input.clientHeight;
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

    let animationFrameID = 0;
    let nestedAnimationFrameID = 0;
    let timeoutID = 0;

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
      const scrollToBottom = () => {
        viewport.scrollTop = viewport.scrollHeight;
      };

      scrollToBottom();
      animationFrameID = window.requestAnimationFrame(() => {
        nestedAnimationFrameID = window.requestAnimationFrame(() => {
          scrollToBottom();
        });
      });
      timeoutID = window.setTimeout(scrollToBottom, 80);
    }

    previousThreadKeyRef.current = threadKey;

    return () => {
      if (animationFrameID !== 0) {
        window.cancelAnimationFrame(animationFrameID);
      }
      if (nestedAnimationFrameID !== 0) {
        window.cancelAnimationFrame(nestedAnimationFrameID);
      }
      if (timeoutID !== 0) {
        window.clearTimeout(timeoutID);
      }
    };
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
        viewport.scrollTop = viewport.scrollHeight;
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
