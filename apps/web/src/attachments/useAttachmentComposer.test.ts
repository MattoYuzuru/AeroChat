import { describe, expect, it } from "vitest";
import { buildAttachmentComposerScopeKey } from "./useAttachmentComposer";

describe("buildAttachmentComposerScopeKey", () => {
  it("returns the same key for semantically identical direct scopes", () => {
    expect(
      buildAttachmentComposerScopeKey({
        kind: "direct",
        id: "chat-1",
      }),
    ).toBe(
      buildAttachmentComposerScopeKey({
        kind: "direct",
        id: "chat-1",
      }),
    );
  });

  it("distinguishes direct and group scopes with the same id", () => {
    expect(
      buildAttachmentComposerScopeKey({
        kind: "direct",
        id: "scope-1",
      }),
    ).not.toBe(
      buildAttachmentComposerScopeKey({
        kind: "group",
        id: "scope-1",
      }),
    );
  });

  it("returns null when composer scope is absent", () => {
    expect(buildAttachmentComposerScopeKey(null)).toBeNull();
  });
});
