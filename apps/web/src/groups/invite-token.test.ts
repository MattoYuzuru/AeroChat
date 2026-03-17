import { describe, expect, it } from "vitest";
import { extractGroupInviteToken } from "./invite-token";

describe("extractGroupInviteToken", () => {
  it("returns raw token when plain value is provided", () => {
    expect(extractGroupInviteToken(" ginv_demo ")).toBe("ginv_demo");
  });

  it("extracts token from absolute url", () => {
    expect(
      extractGroupInviteToken("https://aerochat.local/app/groups?join=ginv_demo"),
    ).toBe("ginv_demo");
  });

  it("extracts token from relative url", () => {
    expect(extractGroupInviteToken("/app/groups?join=ginv_demo")).toBe("ginv_demo");
  });
});
