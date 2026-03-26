import { describe, expect, it } from "vitest";
import { describeEncryptedDirectMessageV2LaneEmptyState } from "./useEncryptedDirectMessageV2Lane";

describe("describeEncryptedDirectMessageV2LaneEmptyState", () => {
  it("explains linked-device history limitation for empty encrypted lane", () => {
    expect(describeEncryptedDirectMessageV2LaneEmptyState(0)).toContain(
      "freshly linked устройство",
    );
    expect(describeEncryptedDirectMessageV2LaneEmptyState(0)).toContain(
      "backfill старой encrypted history",
    );
  });

  it("returns empty string when lane already has items", () => {
    expect(describeEncryptedDirectMessageV2LaneEmptyState(1)).toBe("");
  });
});
