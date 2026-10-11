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
    it("converges equal/lower revision accepted edits across reverse/split arrival, content retry and reload", () => {
      const first = content("first", "1", "2099-01-01T00:00:00Z");
      const second = content("second", "2", "2000-01-01T00:00:00Z");
      const editA: EncryptedDirectMessageV2ReadyProjection = {
        ...content("device-a-edit", "3", "1999-01-01T00:00:00Z"),
        operationKind: "edit", targetMessageId: "first", revision: 2,
        text: "device A", editedAt: "1999-01-01T00:00:00Z",
      };
      const editB: EncryptedDirectMessageV2ReadyProjection = {
        ...editA, messageId: "device-b-edit", serverSequence: "4", text: "device B",
        createdAt: "1998-01-01T00:00:00Z", editedAt: "1998-01-01T00:00:00Z",
      };
      const laterLowRevision: EncryptedDirectMessageV2ReadyProjection = {
        ...editB, messageId: "later-low-revision", serverSequence: "5", revision: 1,
        text: "later accepted", editedAt: "1997-01-01T00:00:00Z",
      };
      const apply = (current: ReturnType<typeof merge>, updates: EncryptedDirectMessageV2ReadyProjection[]) =>
        lane === "direct"
          ? mergeEncryptedDirectMessageV2Projection(current as ReturnType<typeof mergeEncryptedDirectMessageV2Projection>, updates)
          : mergeEncryptedGroupProjection(current as ReturnType<typeof mergeEncryptedGroupProjection>, updates.map(group));
      const seed = merge([first, second]);
      const ordered = apply(apply(seed, [editA]), [editB]);
      const reversed = apply(apply(seed, [editB]), [editA]);
      expect(ordered).toEqual(reversed);
      expect(reversed).toEqual(merge([second, editA, first, editB]));
      expect(reversed[0]).toMatchObject({ text: "device B", revision: 2, serverSequence: "1", lastAppliedServerSequence: "4" });
      expect(apply(reversed, [editA, editB, first])).toEqual(reversed);
      const latest = apply(reversed, [laterLowRevision]);
      expect(latest[0]).toMatchObject({ text: "later accepted", revision: 1, serverSequence: "1", lastAppliedServerSequence: "5" });
      expect(latest).toEqual(merge([laterLowRevision, editB, second, first, editA]));
      expect(apply(latest, [first, editA, editB])).toEqual(latest);
    });
    it("keeps tombstone terminal across all edit/delete arrival permutations and old duplicate replay", () => {
      const first = content("first", "1", "2099-01-01T00:00:00Z");
      const edit: EncryptedDirectMessageV2ReadyProjection = {
        ...content("edit", "2", "1999-01-01T00:00:00Z"), operationKind: "edit",
        targetMessageId: "first", revision: 2, text: "edited", editedAt: "1999-01-01T00:00:00Z",
      };
      const remove: EncryptedDirectMessageV2ReadyProjection = {
        ...content("delete", "3", "1998-01-01T00:00:00Z"), operationKind: "tombstone",
        targetMessageId: "first", revision: 2, text: null, deletedAt: "1998-01-01T00:00:00Z",
      };
      const lateEdit: EncryptedDirectMessageV2ReadyProjection = {
        ...edit, messageId: "accepted-late-edit", serverSequence: "4", revision: 1,
        text: "must stay hidden", editedAt: "1997-01-01T00:00:00Z", replyToMessageId: "quoted",
      };
      const apply = (current: ReturnType<typeof merge>, update: EncryptedDirectMessageV2ReadyProjection) =>
        lane === "direct"
          ? mergeEncryptedDirectMessageV2Projection(current as ReturnType<typeof mergeEncryptedDirectMessageV2Projection>, [update])
          : mergeEncryptedGroupProjection(current as ReturnType<typeof mergeEncryptedGroupProjection>, [group(update)]);
      const expected = merge([first, edit, remove, lateEdit]);
      expect(expected[0]).toMatchObject({ text: null, attachments: [], isTombstone: true,
        serverSequence: "1", lastAppliedServerSequence: "4", lastEditServerSequence: "4",
        tombstoneServerSequence: "3", revision: 1, deletedAt: remove.deletedAt,
        editedAt: lateEdit.editedAt, replyToMessageId: "quoted" });
      const orders = [[edit, remove, lateEdit], [edit, lateEdit, remove], [remove, edit, lateEdit],
        [remove, lateEdit, edit], [lateEdit, edit, remove], [lateEdit, remove, edit]];
      for (const order of orders) {
        const result = order.reduce((current, update) => apply(current, update), merge([first]));
        expect(result).toEqual(expected);
        expect([first, edit, remove, lateEdit].reduce((current, update) => apply(current, update), result)).toEqual(expected);
      }
    });
    it("rejects an unassigned sequence rather than sorting a fabricated zero", () => {
      expect(() => merge([content("legacy", "", "2026-10-11T00:00:00Z")])).toThrow("порядок сообщений");
    });
  });
}


it("converges group null attachment edits without erasing the last explicit attachment update", () => {
  const first = group(content("first", "1", "2099-01-01T00:00:00Z"));
  const editA: EncryptedGroupReadyProjection = {
    ...first, messageId: "attachment-edit", serverSequence: "2", operationKind: "edit",
    targetMessageId: "first", revision: 2, text: "older text", attachments: [{
      attachmentId: "attachment", relaySchema: "ATTACHMENT_RELAY_SCHEMA_ENCRYPTED_BLOB_V1",
      fileName: "fixture.txt", mimeType: "text/plain", plaintextSizeBytes: 1, ciphertextSizeBytes: 17,
    }],
  };
  const editB: EncryptedGroupReadyProjection = {
    ...editA, messageId: "text-only-edit", serverSequence: "3", text: "newer text", attachments: null,
  };
  const seed = mergeEncryptedGroupProjection([], [first]);
  const ordered = mergeEncryptedGroupProjection(mergeEncryptedGroupProjection(seed, [editA]), [editB]);
  const reversed = mergeEncryptedGroupProjection(mergeEncryptedGroupProjection(seed, [editB]), [editA]);
  expect(reversed).toEqual(ordered);
  expect(reversed).toEqual(mergeEncryptedGroupProjection([], [editB, first, editA]));
  expect(reversed[0]).toMatchObject({ text: "newer text", attachments: editA.attachments,
    lastAppliedServerSequence: "3", lastEditServerSequence: "3", lastAttachmentsServerSequence: "2" });
});
