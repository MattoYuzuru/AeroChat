import { describe, expect, it } from "vitest";
import {
  describeGroupTypingLabel,
  GROUP_TYPING_IDLE_TIMEOUT_MS,
  GROUP_TYPING_REFRESH_INTERVAL_MS,
  resolveGroupTypingSessionTarget,
} from "./typing";

describe("group typing helpers", () => {
  it("starts typing session only for visible loaded writable selected group thread", () => {
    expect(
      resolveGroupTypingSessionTarget({
        enabled: true,
        pageVisible: true,
        selectedGroupId: "group-1",
        snapshotGroupId: "group-1",
        threadId: "thread-1",
        canSendMessages: true,
        composerText: "hello",
      }),
    ).toEqual({
      groupId: "group-1",
      threadId: "thread-1",
    });

    expect(
      resolveGroupTypingSessionTarget({
        enabled: true,
        pageVisible: true,
        selectedGroupId: "group-1",
        snapshotGroupId: "group-2",
        threadId: "thread-1",
        canSendMessages: true,
        composerText: "hello",
      }),
    ).toBeNull();

    expect(
      resolveGroupTypingSessionTarget({
        enabled: true,
        pageVisible: true,
        selectedGroupId: "group-1",
        snapshotGroupId: "group-1",
        threadId: "thread-1",
        canSendMessages: false,
        composerText: "hello",
      }),
    ).toBeNull();
  });

  it("uses the same bounded alpha timing windows as direct typing", () => {
    expect(GROUP_TYPING_REFRESH_INTERVAL_MS).toBe(2500);
    expect(GROUP_TYPING_IDLE_TIMEOUT_MS).toBe(3500);
    expect(GROUP_TYPING_IDLE_TIMEOUT_MS).toBeGreaterThan(
      GROUP_TYPING_REFRESH_INTERVAL_MS,
    );
  });

  it("builds a conservative label from other visible typers only", () => {
    expect(
      describeGroupTypingLabel(
        {
          threadId: "thread-1",
          typers: [
            {
              user: { id: "user-1", login: "alice", nickname: "Alice", avatarUrl: null },
              updatedAt: "2026-04-11T12:00:00Z",
              expiresAt: "2026-04-11T12:00:06Z",
            },
            {
              user: { id: "user-2", login: "bob", nickname: "Bob", avatarUrl: null },
              updatedAt: "2026-04-11T12:00:01Z",
              expiresAt: "2026-04-11T12:00:06Z",
            },
            {
              user: { id: "user-3", login: "charlie", nickname: "Charlie", avatarUrl: null },
              updatedAt: "2026-04-11T12:00:02Z",
              expiresAt: "2026-04-11T12:00:06Z",
            },
            {
              user: { id: "user-4", login: "dana", nickname: "Dana", avatarUrl: null },
              updatedAt: "2026-04-11T12:00:03Z",
              expiresAt: "2026-04-11T12:00:06Z",
            },
          ],
        },
        "user-1",
      ),
    ).toBe("Bob, Charlie и ещё 1 печатают");

    expect(
      describeGroupTypingLabel(
        {
          threadId: "thread-1",
          typers: [
            {
              user: { id: "user-1", login: "alice", nickname: "Alice", avatarUrl: null },
              updatedAt: "2026-04-11T12:00:00Z",
              expiresAt: "2026-04-11T12:00:06Z",
            },
          ],
        },
        "user-1",
      ),
    ).toBeNull();
  });
});
