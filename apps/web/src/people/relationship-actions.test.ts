import { describe, expect, it } from "vitest";
import { resolvePersonRelationshipActions } from "./relationship-actions";

describe("resolvePersonRelationshipActions", () => {
  it("maps friends to chat and remove actions", () => {
    expect(resolvePersonRelationshipActions("friend")).toEqual({
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
    });
  });

  it("maps incoming requests to accept and decline actions", () => {
    expect(resolvePersonRelationshipActions("incoming_request")).toEqual({
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
    });
  });

  it("maps outgoing requests to a single cancel action", () => {
    expect(resolvePersonRelationshipActions("outgoing_request")).toEqual({
      primary: {
        kind: "cancel_request",
        label: "Отменить заявку",
        tone: "secondary",
      },
    });
  });
});
