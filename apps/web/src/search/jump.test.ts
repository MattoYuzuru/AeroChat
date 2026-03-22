import { describe, expect, it } from "vitest";
import {
  clearSearchJumpParams,
  findJumpTarget,
  readSearchJumpIntent,
} from "./jump";

describe("readSearchJumpIntent", () => {
  it("reads message jump only for explicit search-origin params", () => {
    expect(
      readSearchJumpIntent(new URLSearchParams("chat=chat-1&message=msg-1&from=search")),
    ).toEqual({
      messageId: "msg-1",
      lane: "plaintext",
    });
  });

  it("reads explicit encrypted lane marker when it is present", () => {
    expect(
      readSearchJumpIntent(
        new URLSearchParams("chat=chat-1&message=msg-1&from=search&lane=encrypted"),
      ),
    ).toEqual({
      messageId: "msg-1",
      lane: "encrypted",
    });
  });

  it("ignores plain message params without search origin marker", () => {
    expect(readSearchJumpIntent(new URLSearchParams("chat=chat-1&message=msg-1"))).toBeNull();
  });
});

describe("clearSearchJumpParams", () => {
  it("preserves container params and strips only jump markers", () => {
    expect(
      clearSearchJumpParams(
        new URLSearchParams("chat=chat-1&message=msg-1&from=search&lane=encrypted"),
      ).toString(),
    ).toBe("chat=chat-1");
  });
});

describe("findJumpTarget", () => {
  it("returns the matching message when it is already loaded", () => {
    expect(
      findJumpTarget(
        [
          { id: "msg-1", label: "first" },
          { id: "msg-2", label: "second" },
        ],
        "msg-2",
      ),
    ).toEqual({
      id: "msg-2",
      label: "second",
    });
  });
});
