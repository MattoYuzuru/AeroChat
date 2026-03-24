import { describe, expect, it } from "vitest";
import {
  DESKTOP_SHELL_MIN_WIDTH,
  isDesktopShellViewport,
} from "./viewport";

describe("isDesktopShellViewport", () => {
  it("enables desktop shell on wide screens", () => {
    expect(isDesktopShellViewport(DESKTOP_SHELL_MIN_WIDTH)).toBe(true);
    expect(isDesktopShellViewport(1440)).toBe(true);
  });

  it("keeps narrow screens on practical fullscreen flow", () => {
    expect(isDesktopShellViewport(DESKTOP_SHELL_MIN_WIDTH - 1)).toBe(false);
    expect(isDesktopShellViewport(768)).toBe(false);
  });
});
