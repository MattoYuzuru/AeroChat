import { describe, expect, it } from "vitest";
import {
  getViewportDistanceFromBottom,
  isViewportPinnedToBottom,
  resolveViewportScrollTopForPrependedHistory,
  shouldScrollThreadViewportToBottom,
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
});
