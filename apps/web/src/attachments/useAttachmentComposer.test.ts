import { describe, expect, it } from "vitest";
import {
  buildAttachmentComposerScopeKey,
  isLegacyPlaintextGroupAttachmentComposerDescoped,
  LEGACY_GROUP_ATTACHMENT_COMPOSER_DESCOPED_MESSAGE,
} from "./useAttachmentComposer";

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

  it("marks group legacy attachment composer scope as de-scoped", () => {
    expect(
      isLegacyPlaintextGroupAttachmentComposerDescoped({
        kind: "group",
        id: "group-1",
      }),
    ).toBe(true);
    expect(LEGACY_GROUP_ATTACHMENT_COMPOSER_DESCOPED_MESSAGE).toBe(
      "Обычный старый путь вложений для групп больше недоступен. Используйте текущее окно отправки сообщения.",
    );
  });

  it("keeps direct legacy attachment composer scope available", () => {
    expect(
      isLegacyPlaintextGroupAttachmentComposerDescoped({
        kind: "direct",
        id: "chat-1",
      }),
    ).toBe(false);
  });
});
