import { describe, expect, it } from "vitest";
import { buildEncryptedMediaAttachmentDraftScopeKey } from "./useEncryptedMediaAttachmentDraft";

describe("buildEncryptedMediaAttachmentDraftScopeKey", () => {
  it("returns the same key for semantically identical direct scopes", () => {
    expect(
      buildEncryptedMediaAttachmentDraftScopeKey({
        kind: "direct",
        id: "chat-1",
      }),
    ).toBe(
      buildEncryptedMediaAttachmentDraftScopeKey({
        kind: "direct",
        id: "chat-1",
      }),
    );
  });

  it("distinguishes direct and group scopes with the same id", () => {
    expect(
      buildEncryptedMediaAttachmentDraftScopeKey({
        kind: "direct",
        id: "scope-1",
      }),
    ).not.toBe(
      buildEncryptedMediaAttachmentDraftScopeKey({
        kind: "group",
        id: "scope-1",
      }),
    );
  });

  it("returns null when scope is absent", () => {
    expect(buildEncryptedMediaAttachmentDraftScopeKey(null)).toBeNull();
  });
});
