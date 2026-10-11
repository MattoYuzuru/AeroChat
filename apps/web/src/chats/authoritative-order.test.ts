import { describe, expect, it } from "vitest";
import type { EncryptedDirectMessageV2ReadyProjection, EncryptedGroupReadyProjection } from "../crypto/types";
import { mergeEncryptedGroupProjection } from "../groups/encrypted-group-projection";
import { mergeEncryptedDirectMessageV2Projection } from "./encrypted-v2-projection";
function content(messageId: string, serverSequence: string, createdAt: string): EncryptedDirectMessageV2ReadyProjection {
  return { status: "ready", messageId, chatId: "chat", senderUserId: "sender", senderCryptoDeviceId: "device",
    operationKind: "content", targetMessageId: null, revision: 1, replyToMessageId: null,
    createdAt, serverSequence, storedAt: "2026-10-11T10:00:00Z", payloadSchema: "aerochat.web.encrypted_direct_message_v2.payload.v1",
    text: messageId, markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1", attachments: [],
    editedAt: null, deletedAt: null };
}
function group(value: EncryptedDirectMessageV2ReadyProjection): EncryptedGroupReadyProjection {
  const { chatId, ...metadata } = value;
  return groupMetadata(chatId, metadata);
}
function groupMetadata(groupId: string, metadata: Omit<EncryptedDirectMessageV2ReadyProjection, "chatId">): EncryptedGroupReadyProjection {
  return { ...metadata, groupId, threadId: "thread", mlsGroupId: "mls", rosterVersion: 1, payloadSchema: "aerochat.web.encrypted_group_message_v1.payload.v1" };
}
for (const lane of ["direct", "group"] as const) {
  describe(`${lane} authoritative projection`, () => {
    const merge = (updates: readonly EncryptedDirectMessageV2ReadyProjection[], limit = 50) => lane === "direct" ? mergeEncryptedDirectMessageV2Projection([], [...updates], limit) : mergeEncryptedGroupProjection([], updates.map(group), limit);
    it("orders backdated/future/tied content by server sequence and keeps the newest bounded history", () => {
      const updates = [content("future", "9007199254740992", "2099-01-01T00:00:00Z"), content("backdated", "9007199254740993", "2001-01-01T00:00:00Z"), content("tied", "9007199254740994", "2001-01-01T00:00:00Z")] as const;
      expect(merge([updates[2], updates[0], updates[1]]).map((entry) => entry.messageId)).toEqual(["future", "backdated", "tied"]);
      expect(merge(updates, 2).map((entry) => entry.messageId)).toEqual(["backdated", "tied"]);
    });
    it("replays edits/tombstones in authoritative order without moving their original content", () => {
      const first = content("first", "1", "2099-01-01T00:00:00Z");
      const second = content("second", "2", "2000-01-01T00:00:00Z");
      const edit: EncryptedDirectMessageV2ReadyProjection = { ...content("edit", "3", "1999-01-01T00:00:00Z"),
        operationKind: "edit", targetMessageId: "first", revision: 2, text: "edited",
        editedAt: "1999-01-01T00:00:00Z" };
      const tombstone: EncryptedDirectMessageV2ReadyProjection = { ...content("delete", "4", "1998-01-01T00:00:00Z"), operationKind: "tombstone", targetMessageId: "first",
        revision: 3, text: null, deletedAt: "1998-01-01T00:00:00Z" };
      const result = merge([tombstone, second, edit, first]);
      expect(result.map((entry) => [entry.messageId, entry.serverSequence])).toEqual([["first", "1"], ["second", "2"]]);
      expect(result[0]).toMatchObject({ revision: 3, text: null, isTombstone: true, createdAt: first.createdAt });
      const replay = lane === "direct" ? mergeEncryptedDirectMessageV2Projection(result as ReturnType<typeof mergeEncryptedDirectMessageV2Projection>, [edit]) : mergeEncryptedGroupProjection(result as ReturnType<typeof mergeEncryptedGroupProjection>, [group(edit)]);
      expect(replay).toEqual(result);
      expect(merge([first, edit, second, tombstone])).toEqual(result);
    });
    it("rejects an unassigned sequence rather than sorting a fabricated zero", () => {
      expect(() => merge([content("legacy", "", "2026-10-11T00:00:00Z")])).toThrow("порядок сообщений");
    });
  });
}
