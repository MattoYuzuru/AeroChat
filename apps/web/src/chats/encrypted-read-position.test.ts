import { describe, expect, it } from "vitest";
import { isEncryptedMessageReadByPeer } from "./encrypted-read-position";
describe("encrypted peer read watermark", () => {
  it("uses the content sequence despite equal or skewed display timestamps", () => {
    const watermark = { lastReadServerSequence: "9007199254740993" };
    expect(isEncryptedMessageReadByPeer({ serverSequence: "9007199254740992" }, watermark)).toBe(true);
    expect(isEncryptedMessageReadByPeer({ serverSequence: "9007199254740993" }, watermark)).toBe(true);
    expect(isEncryptedMessageReadByPeer({ serverSequence: "9007199254740994" }, watermark)).toBe(false);
    expect(isEncryptedMessageReadByPeer({ serverSequence: "1" }, null)).toBe(false);
    expect(() => isEncryptedMessageReadByPeer({ serverSequence: "1" }, { lastReadServerSequence: "0" })).toThrow();
  });
});
