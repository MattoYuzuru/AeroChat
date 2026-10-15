import { describe, expect, it } from "vitest";
import { isThreadReadVisible } from "./read-visibility";

describe("thread read visibility", () => {
  it("preserves unread while minimized, then allows read progression on restore", () => {
    const visible = { pageVisible: true, windowVisible: true, timelineVisible: true };
    expect(isThreadReadVisible({ ...visible, windowVisible: false })).toBe(false);
    expect(isThreadReadVisible(visible)).toBe(true);
  });

  it("preserves unread in a hidden browser tab or group information view", () => {
    expect(isThreadReadVisible({ pageVisible: false, windowVisible: true, timelineVisible: true })).toBe(false);
    expect(isThreadReadVisible({ pageVisible: true, windowVisible: true, timelineVisible: false })).toBe(false);
  });

  it("treats visible windows independently without requiring the focused window", () => {
    const firstWindow = { pageVisible: true, windowVisible: false, timelineVisible: true };
    const secondWindow = { pageVisible: true, windowVisible: true, timelineVisible: true };
    expect(isThreadReadVisible(firstWindow)).toBe(false);
    expect(isThreadReadVisible(secondWindow)).toBe(true);
  });
});
