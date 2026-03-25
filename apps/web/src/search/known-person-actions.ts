import type { PersonProfileEntry } from "../people/profile-model";
import { resolvePersonRelationshipActions } from "../people/relationship-actions";

export interface KnownPersonCardAction {
  label: string;
  onClick(): void;
  tone: "primary" | "secondary" | "danger";
  disabled?: boolean;
}

export function resolveKnownPersonPrimaryAction({
  entry,
  isChatBusy,
  isOpeningChat,
  onAccept,
  onCancelOutgoing,
  onOpenChat,
}: {
  entry: PersonProfileEntry;
  isChatBusy: boolean;
  isOpeningChat: boolean;
  onAccept(): void;
  onCancelOutgoing(): void;
  onOpenChat(): void;
}): KnownPersonCardAction {
  const relationshipActions = resolvePersonRelationshipActions(entry.relationshipKind);

  switch (entry.relationshipKind) {
    case "friend":
      return {
        label: isOpeningChat ? "Открываем чат..." : relationshipActions.primary.label,
        onClick: onOpenChat,
        tone: relationshipActions.primary.tone,
        disabled: isChatBusy,
      };
    case "incoming_request":
      return {
        label: relationshipActions.primary.label,
        onClick: onAccept,
        tone: relationshipActions.primary.tone,
      };
    case "outgoing_request":
      return {
        label: relationshipActions.primary.label,
        onClick: onCancelOutgoing,
        tone: relationshipActions.primary.tone,
      };
    default:
      return {
        label: relationshipActions.primary.label,
        onClick: onOpenChat,
        tone: relationshipActions.primary.tone,
      };
  }
}

export function resolveKnownPersonSecondaryAction({
  entry,
  isChatBusy,
  onDecline,
  onRemoveFriend,
}: {
  entry: PersonProfileEntry;
  isChatBusy: boolean;
  onDecline(): void;
  onRemoveFriend(): void;
}): KnownPersonCardAction | undefined {
  const relationshipActions = resolvePersonRelationshipActions(entry.relationshipKind);

  if (entry.relationshipKind === "friend") {
    return {
      label: relationshipActions.secondary?.label ?? "Удалить из друзей",
      onClick: onRemoveFriend,
      tone: relationshipActions.secondary?.tone ?? "danger",
      disabled: isChatBusy,
    };
  }

  if (entry.relationshipKind === "incoming_request") {
    return {
      label: relationshipActions.secondary?.label ?? "Отклонить",
      onClick: onDecline,
      tone: relationshipActions.secondary?.tone ?? "secondary",
    };
  }

  return undefined;
}
