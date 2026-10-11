import { describe, expect, it } from "vitest";
import { compareServerSequences, hasValidEncryptedReadSequences, parseServerSequence, requireServerSequence } from "./server-sequence";
describe("authoritative server sequence", () => {
  it("compares int64 strings without floating-point precision loss", () => {
    expect(compareServerSequences("9007199254740992", "9007199254740993")).toBe(-1);
    expect(compareServerSequences("9223372036854775807", "9007199254740993")).toBe(1);
    expect(compareServerSequences("9", "10")).toBe(-1);
    expect(compareServerSequences("1", "1")).toBe(0);
    expect(parseServerSequence("9223372036854775807")).toBe("9223372036854775807");
  });
  it.each([undefined, null, 1, Number("9007199254740993"), "", "0", "01", "-1", "+1", "1.5", "1e3",
    " 1", "1 ", "9223372036854775808", "999999999999999999999"])("rejects missing or invalid authoritative value %s", (value) => {
    expect(parseServerSequence(value)).toBeNull();
    expect(() => requireServerSequence(value)).toThrow("порядок сообщений");
  });
  it("accepts zero only for an explicitly requested counter", () => {
    expect(parseServerSequence("0", true)).toBe("0");
    expect(parseServerSequence("0")).toBeNull();
  });
  it("distinguishes an absent/reset position from an invalid content target", () => {
    expect(hasValidEncryptedReadSequences(null)).toBe(true);
    expect(hasValidEncryptedReadSequences({ selfPosition: null, peerPosition: null })).toBe(true);
    expect(hasValidEncryptedReadSequences({ selfPosition: { lastReadServerSequence: "0" } })).toBe(true);
    expect(hasValidEncryptedReadSequences({ selfPosition: { messageId: "m", lastReadServerSequence: "9007199254740993" } })).toBe(true);
    for (const target of [{ messageId: "m" }, { messageId: "m", lastReadServerSequence: "0" },
      { messageId: "", lastReadServerSequence: "1" }, { messageId: " ", lastReadServerSequence: "1" },
      { messageId: "m", lastReadServerSequence: 1 }]) {
      expect(hasValidEncryptedReadSequences({ peerPosition: target })).toBe(false);
    }
  });
});
