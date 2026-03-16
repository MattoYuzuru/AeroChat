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

  it("calls gateway chat endpoint for explicit direct chat creation", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          chat: {
            id: "chat-1",
            kind: "CHAT_KIND_DIRECT",
            participants: [
              {
                id: "user-1",
                login: "alice",
                nickname: "Alice",
              },
              {
                id: "user-2",
                login: "bob",
                nickname: "Bob",
              },
            ],
            pinnedMessageIds: [],
            createdAt: "2026-03-25T10:00:00Z",
            updatedAt: "2026-03-25T10:00:00Z",
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

    const chat = await client.createDirectChat("token-1", " user-2 ");

    expect(chat.id).toBe("chat-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/aerochat.chat.v1.ChatService/CreateDirectChat",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
        body: JSON.stringify({
          peerUserId: "user-2",
        }),
      }),
    );
  });

  it("normalizes direct chat snapshot and message history", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            chat: {
              id: "chat-1",
              kind: "CHAT_KIND_DIRECT",
              participants: [
                {
                  id: "user-1",
                  login: "alice",
                  nickname: "Alice",
                },
                {
                  id: "user-2",
                  login: "bob",
                  nickname: "Bob",
                  avatarUrl: "",
                },
              ],
              pinnedMessageIds: ["message-1"],
              createdAt: "2026-03-25T10:00:00Z",
              updatedAt: "2026-03-25T10:05:00Z",
            },
            readState: {
              peerPosition: {
                messageId: "message-1",
                messageCreatedAt: "2026-03-25T10:06:00Z",
                updatedAt: "2026-03-25T10:07:00Z",
              },
            },
            presenceState: {
              peerPresence: {
                heartbeatAt: "2026-03-25T10:08:00Z",
                expiresAt: "2026-03-25T10:09:00Z",
              },
            },
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
            messages: [
              {
                id: "message-1",
                chatId: "chat-1",
                senderUserId: "user-1",
                kind: "MESSAGE_KIND_TEXT",
                text: {
                  text: "hello",
                  markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
                },
                pinned: true,
                createdAt: "2026-03-25T10:06:00Z",
                updatedAt: "2026-03-25T10:06:00Z",
              },
              {
                id: "message-2",
                chatId: "chat-1",
                senderUserId: "user-2",
                kind: "MESSAGE_KIND_TEXT",
                tombstone: {
                  deletedByUserId: "user-2",
                  deletedAt: "2026-03-25T10:10:00Z",
                },
                pinned: false,
                createdAt: "2026-03-25T10:09:00Z",
                updatedAt: "2026-03-25T10:10:00Z",
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

    const snapshot = await client.getDirectChat("token-1", "chat-1");
    const messages = await client.listDirectChatMessages("token-1", "chat-1", 25);

    expect(snapshot.chat.pinnedMessageIds).toEqual(["message-1"]);
    expect(snapshot.chat.participants[1]?.avatarUrl).toBeNull();
    expect(snapshot.readState?.peerPosition?.messageId).toBe("message-1");
    expect(snapshot.presenceState?.peerPresence?.heartbeatAt).toBe(
      "2026-03-25T10:08:00Z",
    );
    expect(messages).toEqual([
      expect.objectContaining({
        id: "message-1",
        pinned: true,
        text: expect.objectContaining({
          text: "hello",
        }),
      }),
      expect.objectContaining({
        id: "message-2",
        tombstone: expect.objectContaining({
          deletedByUserId: "user-2",
        }),
      }),
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/aerochat.chat.v1.ChatService/GetDirectChat",
      expect.objectContaining({
        body: JSON.stringify({
          chatId: "chat-1",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/aerochat.chat.v1.ChatService/ListDirectChatMessages",
      expect.objectContaining({
        body: JSON.stringify({
          chatId: "chat-1",
          pageSize: 25,
        }),
      }),
    );
  });

  it("calls message action endpoints with chat and message ids", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const client = createGatewayClient(fetchMock, "/api");

    await client.pinMessage("token-1", "chat-1", "message-1");
    await client.unpinMessage("token-1", "chat-1", "message-1");
    await client.deleteMessageForEveryone("token-1", "chat-1", "message-1");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/aerochat.chat.v1.ChatService/PinMessage",
      expect.objectContaining({
        body: JSON.stringify({
          chatId: "chat-1",
          messageId: "message-1",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/aerochat.chat.v1.ChatService/UnpinMessage",
      expect.objectContaining({
        body: JSON.stringify({
          chatId: "chat-1",
          messageId: "message-1",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/aerochat.chat.v1.ChatService/DeleteMessageForEveryone",
      expect.objectContaining({
        body: JSON.stringify({
          chatId: "chat-1",
          messageId: "message-1",
        }),
      }),
    );
  });
});
