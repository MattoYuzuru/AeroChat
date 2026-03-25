import type { PersonProfileRelationshipKind } from "./profile-model";

export type PersonRelationshipActionKind =
  | "open_chat"
  | "remove_friend"
  | "accept_request"
  | "decline_request"
  | "cancel_request";

export type PersonRelationshipActionTone = "primary" | "secondary" | "danger";

export interface PersonRelationshipAction {
  kind: PersonRelationshipActionKind;
  label: string;
  tone: PersonRelationshipActionTone;
}

export interface PersonRelationshipActionSet {
  primary: PersonRelationshipAction;
  secondary?: PersonRelationshipAction;
}

export function resolvePersonRelationshipActions(
  relationshipKind: PersonProfileRelationshipKind,
): PersonRelationshipActionSet {
  switch (relationshipKind) {
    case "friend":
      return {
        primary: {
          kind: "open_chat",
          label: "Открыть чат",
          tone: "primary",
        },
        secondary: {
          kind: "remove_friend",
          label: "Удалить из друзей",
          tone: "danger",
        },
      };
    case "incoming_request":
      return {
        primary: {
          kind: "accept_request",
          label: "Принять заявку",
          tone: "primary",
        },
        secondary: {
          kind: "decline_request",
          label: "Отклонить",
          tone: "secondary",
        },
      };
    case "outgoing_request":
      return {
        primary: {
          kind: "cancel_request",
          label: "Отменить заявку",
          tone: "secondary",
        },
      };
    default:
      return {
        primary: {
          kind: "open_chat",
          label: "Открыть чат",
          tone: "primary",
        },
      };
  }
}
