import { describe, expect, it, vi } from "vitest";
import type { PersonProfileEntry } from "../people/profile-model";
import {
  resolveKnownPersonPrimaryAction,
  resolveKnownPersonSecondaryAction,
} from "./known-person-actions";

describe("search known person actions", () => {
  it("maps friends to canonical chat and remove actions", () => {
    const entry = createEntry("friend");

    expect(
      resolveKnownPersonPrimaryAction({
        entry,
        isChatBusy: false,
        isOpeningChat: false,
        onAccept: vi.fn(),
        onCancelOutgoing: vi.fn(),
        onOpenChat: vi.fn(),
      }),
    ).toMatchObject({
      label: "Открыть чат",
      tone: "primary",
      disabled: false,
    });

    expect(
      resolveKnownPersonSecondaryAction({
        entry,
        isChatBusy: false,
        onDecline: vi.fn(),
        onRemoveFriend: vi.fn(),
      }),
    ).toMatchObject({
      label: "Удалить из друзей",
      tone: "danger",
      disabled: false,
    });
  });

  it("keeps incoming requests on accept and decline wording", () => {
    const entry = createEntry("incoming_request");

    expect(
      resolveKnownPersonPrimaryAction({
        entry,
        isChatBusy: false,
        isOpeningChat: false,
        onAccept: vi.fn(),
        onCancelOutgoing: vi.fn(),
        onOpenChat: vi.fn(),
      }),
    ).toMatchObject({
      label: "Принять заявку",
      tone: "primary",
    });

    expect(
      resolveKnownPersonSecondaryAction({
        entry,
        isChatBusy: false,
        onDecline: vi.fn(),
        onRemoveFriend: vi.fn(),
      }),
    ).toMatchObject({
      label: "Отклонить",
      tone: "secondary",
    });
  });

  it("keeps outgoing requests on a single cancel action", () => {
    const entry = createEntry("outgoing_request");

    expect(
      resolveKnownPersonPrimaryAction({
        entry,
        isChatBusy: false,
        isOpeningChat: false,
        onAccept: vi.fn(),
        onCancelOutgoing: vi.fn(),
        onOpenChat: vi.fn(),
      }),
    ).toMatchObject({
      label: "Отменить заявку",
      tone: "secondary",
    });

    expect(
      resolveKnownPersonSecondaryAction({
        entry,
        isChatBusy: false,
        onDecline: vi.fn(),
        onRemoveFriend: vi.fn(),
      }),
    ).toBeUndefined();
  });

  it("marks friend chat actions as busy while canonical direct chat is opening", () => {
    const entry = createEntry("friend");

    expect(
      resolveKnownPersonPrimaryAction({
        entry,
        isChatBusy: true,
        isOpeningChat: true,
        onAccept: vi.fn(),
        onCancelOutgoing: vi.fn(),
        onOpenChat: vi.fn(),
      }),
    ).toMatchObject({
      label: "Открываем чат...",
      disabled: true,
    });
  });
});

function createEntry(
  relationshipKind: PersonProfileEntry["relationshipKind"],
): PersonProfileEntry {
  return {
    relationshipKind,
    profile: {
      id: "user-1",
      login: "alice",
      nickname: "Alice",
      avatarUrl: null,
      bio: null,
      timezone: null,
      profileAccent: null,
      statusText: null,
      birthday: null,
      country: null,
      city: null,
      readReceiptsEnabled: true,
      presenceEnabled: true,
      typingVisibilityEnabled: true,
      keyBackupStatus: "KEY_BACKUP_STATUS_CONFIGURED",
      createdAt: "2026-03-01T10:00:00Z",
      updatedAt: "2026-03-01T10:00:00Z",
    },
    friendsSince: relationshipKind === "friend" ? "2026-03-01T10:00:00Z" : null,
    requestedAt:
      relationshipKind === "incoming_request" || relationshipKind === "outgoing_request"
        ? "2026-03-02T10:00:00Z"
        : null,
  };
}
