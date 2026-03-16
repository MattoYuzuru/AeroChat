import { describe, expect, it, vi } from "vitest";
import { createGatewayClient } from "./client";
import { GatewayError } from "./types";

describe("createGatewayClient", () => {
  it("calls gateway identity endpoint with connect json payload", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          auth: {
            profile: {
              id: "user-1",
              login: "alice",
              nickname: "Alice",
              createdAt: "2026-03-23T10:00:00Z",
              updatedAt: "2026-03-23T10:00:00Z",
            },
            sessionToken: "token-1",
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );
    const client = createGatewayClient(fetchMock, "/api");

    const result = await client.register({
      login: "alice",
      password: "CorrectHorseBatteryStaple1",
      nickname: "Alice",
      deviceLabel: "Web client",
    });

    expect(result.sessionToken).toBe("token-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/aerochat.identity.v1.IdentityService/Register",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Accept: "application/json",
          "Connect-Protocol-Version": "1",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          login: "alice",
          password: "CorrectHorseBatteryStaple1",
          nickname: "Alice",
          deviceLabel: "Web client",
        }),
      }),
    );
  });

  it("adds bearer token and normalizes empty profile fields to null", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          profile: {
            id: "user-1",
            login: "alice",
            nickname: "Alice",
            avatarUrl: "",
            bio: "hello",
            createdAt: "2026-03-23T10:00:00Z",
            updatedAt: "2026-03-23T10:00:00Z",
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );
    const client = createGatewayClient(fetchMock, "/api");

    const profile = await client.getCurrentProfile("token-1");

    expect(profile.avatarUrl).toBeNull();
    expect(profile.bio).toBe("hello");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/aerochat.identity.v1.IdentityService/GetCurrentProfile",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
      }),
    );
  });

  it("maps connect errors to GatewayError", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          code: "invalid_argument",
          message: "nickname must be between 1 and 64 characters",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );
    const client = createGatewayClient(fetchMock, "/api");

    await expect(
      client.updateCurrentProfile("token-1", {
        nickname: "",
        avatarUrl: "",
        bio: "",
        timezone: "",
        profileAccent: "",
        statusText: "",
        birthday: "",
        country: "",
        city: "",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<GatewayError>>({
        name: "GatewayError",
        code: "invalid_argument",
        httpStatus: 400,
      }),
    );
  });

  it("calls social graph mutation endpoints with exact login payload", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const client = createGatewayClient(fetchMock, "/api");

    await client.sendFriendRequest("token-1", " alice ");
    await client.cancelOutgoingFriendRequest("token-1", "alice");
    await client.removeFriend("token-1", "alice");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/aerochat.identity.v1.IdentityService/SendFriendRequest",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
        body: JSON.stringify({
          login: "alice",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/aerochat.identity.v1.IdentityService/CancelOutgoingFriendRequest",
      expect.objectContaining({
        body: JSON.stringify({
          login: "alice",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/aerochat.identity.v1.IdentityService/RemoveFriend",
      expect.objectContaining({
        body: JSON.stringify({
          login: "alice",
        }),
      }),
    );
  });

  it("normalizes incoming requests and friends from social graph responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            friendRequests: [
              {
                profile: {
                  id: "user-2",
                  login: "bob",
                  nickname: "Bob",
                  avatarUrl: "",
                  createdAt: "2026-03-24T10:00:00Z",
                  updatedAt: "2026-03-24T10:00:00Z",
                },
                requestedAt: "2026-03-24T11:00:00Z",
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            friends: [
              {
                profile: {
                  id: "user-3",
                  login: "charlie",
                  nickname: "Charlie",
                  bio: "friend",
                  createdAt: "2026-03-24T10:00:00Z",
                  updatedAt: "2026-03-24T10:00:00Z",
                },
                friendsSince: "2026-03-24T12:00:00Z",
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      );
    const client = createGatewayClient(fetchMock, "/api");

    const incoming = await client.listIncomingFriendRequests("token-1");
    const friends = await client.listFriends("token-1");

    expect(incoming).toEqual([
      expect.objectContaining({
        requestedAt: "2026-03-24T11:00:00Z",
        profile: expect.objectContaining({
          login: "bob",
          avatarUrl: null,
        }),
      }),
    ]);
    expect(friends).toEqual([
      expect.objectContaining({
        friendsSince: "2026-03-24T12:00:00Z",
        profile: expect.objectContaining({
          login: "charlie",
          bio: "friend",
        }),
      }),
    ]);
  });
});
