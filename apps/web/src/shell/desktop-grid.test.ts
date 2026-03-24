import { describe, expect, it } from "vitest";
import {
  resolveDesktopGridCellIndex,
  resolveDesktopGridMetrics,
} from "./desktop-grid";

describe("desktop grid", () => {
  it("derives desktop capacity from the available viewport instead of a fixed cap", () => {
    const compactMetrics = resolveDesktopGridMetrics({
      width: 640,
      height: 480,
    });
    const wideMetrics = resolveDesktopGridMetrics({
      width: 1440,
      height: 900,
    });

    expect(compactMetrics.capacity).toBeGreaterThan(0);
    expect(wideMetrics.columns).toBeGreaterThan(compactMetrics.columns);
    expect(wideMetrics.rows).toBeGreaterThan(compactMetrics.rows);
    expect(wideMetrics.capacity).toBeGreaterThan(compactMetrics.capacity);
  });

  it("maps a desktop point to the nearest bounded grid cell", () => {
    const metrics = resolveDesktopGridMetrics({
      width: 1280,
      height: 720,
    });

    expect(
      resolveDesktopGridCellIndex(
        {
          x: 24,
          y: 72,
        },
        metrics,
      ),
    ).toBe(0);
    expect(
      resolveDesktopGridCellIndex(
        {
          x: 420,
          y: 340,
        },
        metrics,
      ),
    ).toBeGreaterThan(0);
  });
});
