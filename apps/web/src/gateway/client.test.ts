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
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<GatewayError>>({
        name: "GatewayError",
        code: "invalid_argument",
        httpStatus: 400,
      }),
    );
  });

  it("sends partial settings patch through gateway identity endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          profile: {
            id: "user-1",
            login: "alice",
            nickname: "Alice",
            timezone: "Asia/Tokyo",
            profileAccent: "silver-sky",
            statusText: "Вечером на связи",
            readReceiptsEnabled: false,
            presenceEnabled: true,
            typingVisibilityEnabled: false,
            createdAt: "2026-03-23T10:00:00Z",
            updatedAt: "2026-03-24T10:00:00Z",
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

    await client.updateCurrentProfile("token-1", {
      timezone: "Asia/Tokyo",
      profileAccent: "silver-sky",
      statusText: "Вечером на связи",
      readReceiptsEnabled: false,
      presenceEnabled: true,
      typingVisibilityEnabled: false,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/aerochat.identity.v1.IdentityService/UpdateCurrentProfile",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
        body: JSON.stringify({
          timezone: "Asia/Tokyo",
          profileAccent: "silver-sky",
          statusText: "Вечером на связи",
          readReceiptsEnabled: false,
          presenceEnabled: true,
          typingVisibilityEnabled: false,
        }),
      }),
    );
  });

  it("loads devices with nested sessions through gateway identity endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          devices: [
            {
              device: {
                id: "device-1",
                label: "Web Chrome",
                createdAt: "2026-03-28T10:00:00Z",
                lastSeenAt: "2026-03-28T12:00:00Z",
              },
              sessions: [
                {
                  id: "session-1",
                  deviceId: "device-1",
                  createdAt: "2026-03-28T10:00:00Z",
                  lastSeenAt: "2026-03-28T12:00:00Z",
                },
                {
                  id: "session-2",
                  deviceId: "device-1",
                  createdAt: "2026-03-28T11:00:00Z",
                  lastSeenAt: "2026-03-28T11:30:00Z",
                  revokedAt: "2026-03-28T11:45:00Z",
                },
              ],
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

    const devices = await client.listDevices("token-1");

    expect(devices).toEqual([
      {
        device: {
          id: "device-1",
          label: "Web Chrome",
          createdAt: "2026-03-28T10:00:00Z",
          lastSeenAt: "2026-03-28T12:00:00Z",
          revokedAt: null,
        },
        sessions: [
          {
            id: "session-1",
            deviceId: "device-1",
            createdAt: "2026-03-28T10:00:00Z",
            lastSeenAt: "2026-03-28T12:00:00Z",
            revokedAt: null,
          },
          {
            id: "session-2",
            deviceId: "device-1",
            createdAt: "2026-03-28T11:00:00Z",
            lastSeenAt: "2026-03-28T11:30:00Z",
            revokedAt: "2026-03-28T11:45:00Z",
          },
        ],
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/aerochat.identity.v1.IdentityService/ListDevices",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
        body: JSON.stringify({}),
      }),
    );
  });

  it("sends revoke target through the shared identity endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const client = createGatewayClient(fetchMock, "/api");

    await client.revokeSessionOrDevice("token-1", {
      kind: "session",
      sessionId: " session-1 ",
    });
    await client.revokeSessionOrDevice("token-1", {
      kind: "device",
      deviceId: " device-1 ",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/aerochat.identity.v1.IdentityService/RevokeSessionOrDevice",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
        body: JSON.stringify({
          sessionId: "session-1",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/aerochat.identity.v1.IdentityService/RevokeSessionOrDevice",
      expect.objectContaining({
        body: JSON.stringify({
          deviceId: "device-1",
        }),
      }),
    );
  });

  it("calls group membership management endpoints through gateway chat service", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () =>
        new Response(
          JSON.stringify({
            member: {
              user: {
                id: "user-2",
                login: "bob",
                nickname: "Bob",
              },
              role: "GROUP_MEMBER_ROLE_ADMIN",
              joinedAt: "2026-04-09T10:00:00Z",
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
      .mockImplementationOnce(async () =>
        new Response(
          JSON.stringify({
            group: {
              id: "group-1",
              name: "Ops",
              kind: "CHAT_KIND_GROUP",
              selfRole: "GROUP_MEMBER_ROLE_ADMIN",
              memberCount: 2,
              createdAt: "2026-04-09T09:00:00Z",
              updatedAt: "2026-04-09T11:00:00Z",
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
      .mockImplementationOnce(async () => new Response("{}", { status: 200 }))
      .mockImplementationOnce(async () => new Response("{}", { status: 200 }));
    const client = createGatewayClient(fetchMock, "/api");

    const updatedMember = await client.updateGroupMemberRole(
      "token-1",
      " group-1 ",
      " user-2 ",
      "admin",
    );
    const transferredGroup = await client.transferGroupOwnership(
      "token-1",
      " group-1 ",
      " user-2 ",
    );
    await client.removeGroupMember("token-1", " group-1 ", " user-3 ");
    await client.leaveGroup("token-1", " group-1 ");

    expect(updatedMember.role).toBe("admin");
    expect(transferredGroup.selfRole).toBe("admin");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/aerochat.chat.v1.ChatService/UpdateGroupMemberRole",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
        body: JSON.stringify({
          groupId: "group-1",
          userId: "user-2",
          role: "GROUP_MEMBER_ROLE_ADMIN",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/aerochat.chat.v1.ChatService/TransferGroupOwnership",
      expect.objectContaining({
        body: JSON.stringify({
          groupId: "group-1",
          targetUserId: "user-2",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/aerochat.chat.v1.ChatService/RemoveGroupMember",
      expect.objectContaining({
        body: JSON.stringify({
          groupId: "group-1",
          userId: "user-3",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/aerochat.chat.v1.ChatService/LeaveGroup",
      expect.objectContaining({
        body: JSON.stringify({
          groupId: "group-1",
        }),
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

  it("sends direct chat presence heartbeat through gateway chat endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          presenceState: {
            selfPresence: {
              heartbeatAt: "2026-04-06T12:00:00Z",
              expiresAt: "2026-04-06T12:00:30Z",
            },
            peerPresence: {
              heartbeatAt: "2026-04-06T11:59:58Z",
              expiresAt: "2026-04-06T12:00:28Z",
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
    );
    const client = createGatewayClient(fetchMock, "/api");

    const presenceState = await client.setDirectChatPresenceHeartbeat(
      "token-1",
      "chat-1",
    );

    expect(presenceState?.selfPresence?.heartbeatAt).toBe("2026-04-06T12:00:00Z");
    expect(presenceState?.peerPresence?.heartbeatAt).toBe("2026-04-06T11:59:58Z");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/aerochat.chat.v1.ChatService/SetDirectChatPresenceHeartbeat",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
        body: JSON.stringify({
          chatId: "chat-1",
        }),
      }),
    );
  });

  it("normalizes group chat snapshot with typing state", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          group: {
            id: "group-1",
            name: "Ops Room",
            kind: "CHAT_KIND_GROUP",
            selfRole: "GROUP_MEMBER_ROLE_MEMBER",
            memberCount: 3,
            createdAt: "2026-04-10T10:00:00Z",
            updatedAt: "2026-04-11T10:00:00Z",
          },
          thread: {
            id: "thread-1",
            groupId: "group-1",
            threadKey: "primary",
            canSendMessages: true,
            createdAt: "2026-04-10T10:00:00Z",
            updatedAt: "2026-04-11T10:00:00Z",
          },
          typingState: {
            threadId: "thread-1",
            typers: [
              {
                user: {
                  id: "user-2",
                  login: "bob",
                  nickname: "Bob",
                },
                updatedAt: "2026-04-11T10:00:00Z",
                expiresAt: "2026-04-11T10:00:06Z",
              },
            ],
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

    const snapshot = await client.getGroupChat("token-1", "group-1");

    expect(snapshot.group.selfRole).toBe("member");
    expect(snapshot.thread.id).toBe("thread-1");
    expect(snapshot.typingState?.threadId).toBe("thread-1");
    expect(snapshot.typingState?.typers[0]?.user.id).toBe("user-2");
  });

  it("calls attachment upload and access endpoints through gateway chat service", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            attachment: {
              id: "attachment-1",
              ownerUserId: "user-1",
              scope: "ATTACHMENT_SCOPE_DIRECT_CHAT",
              directChatId: "chat-1",
              fileName: "report.pdf",
              mimeType: "application/pdf",
              sizeBytes: 4096,
              status: "ATTACHMENT_STATUS_PENDING",
              createdAt: "2026-04-14T10:00:00Z",
              updatedAt: "2026-04-14T10:00:00Z",
            },
            uploadSession: {
              id: "upload-1",
              attachmentId: "attachment-1",
              status: "ATTACHMENT_UPLOAD_SESSION_STATUS_PENDING",
              uploadUrl: "https://media.example.invalid/put",
              httpMethod: "PUT",
              headers: {
                "Content-Type": "application/pdf",
              },
              createdAt: "2026-04-14T10:00:00Z",
              updatedAt: "2026-04-14T10:00:00Z",
              expiresAt: "2026-04-14T10:15:00Z",
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
            attachment: {
              id: "attachment-1",
              ownerUserId: "user-1",
              scope: "ATTACHMENT_SCOPE_DIRECT_CHAT",
              directChatId: "chat-1",
              fileName: "report.pdf",
              mimeType: "application/pdf",
              sizeBytes: 4096,
              status: "ATTACHMENT_STATUS_UPLOADED",
              createdAt: "2026-04-14T10:00:00Z",
              updatedAt: "2026-04-14T10:01:00Z",
              uploadedAt: "2026-04-14T10:01:00Z",
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
            attachment: {
              id: "attachment-1",
              ownerUserId: "user-1",
              scope: "ATTACHMENT_SCOPE_DIRECT_CHAT",
              directChatId: "chat-1",
              messageId: "message-1",
              fileName: "report.pdf",
              mimeType: "application/pdf",
              sizeBytes: 4096,
              status: "ATTACHMENT_STATUS_ATTACHED",
              createdAt: "2026-04-14T10:00:00Z",
              updatedAt: "2026-04-14T10:02:00Z",
              uploadedAt: "2026-04-14T10:01:00Z",
              attachedAt: "2026-04-14T10:02:00Z",
            },
            downloadUrl: "https://media.example.invalid/get",
            downloadExpiresAt: "2026-04-14T10:17:00Z",
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

    const intent = await client.createAttachmentUploadIntent("token-1", {
      directChatId: " chat-1 ",
      fileName: " report.pdf ",
      mimeType: " application/pdf ",
      sizeBytes: 4096,
    });
    const uploadedAttachment = await client.completeAttachmentUpload(
      "token-1",
      " attachment-1 ",
      " upload-1 ",
    );
    const access = await client.getAttachment("token-1", " attachment-1 ");

    expect(intent.uploadSession.uploadUrl).toBe("https://media.example.invalid/put");
    expect(uploadedAttachment.status).toBe("ATTACHMENT_STATUS_UPLOADED");
    expect(access.downloadUrl).toBe("https://media.example.invalid/get");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/aerochat.chat.v1.ChatService/CreateAttachmentUploadIntent",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
        body: JSON.stringify({
          directChatId: "chat-1",
          fileName: "report.pdf",
          mimeType: "application/pdf",
          sizeBytes: "4096",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/aerochat.chat.v1.ChatService/CompleteAttachmentUpload",
      expect.objectContaining({
        body: JSON.stringify({
          attachmentId: "attachment-1",
          uploadSessionId: "upload-1",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/aerochat.chat.v1.ChatService/GetAttachment",
      expect.objectContaining({
        body: JSON.stringify({
          attachmentId: "attachment-1",
        }),
      }),
    );
  });

  it("sets and clears group typing through gateway chat endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            typingState: {
              threadId: "thread-1",
              typers: [
                {
                  user: {
                    id: "user-1",
                    login: "alice",
                    nickname: "Alice",
                  },
                  updatedAt: "2026-04-11T10:00:00Z",
                  expiresAt: "2026-04-11T10:00:06Z",
                },
              ],
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
            typingState: {
              threadId: "thread-1",
              typers: [],
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

    const typingState = await client.setGroupTyping("token-1", "group-1", "thread-1");
    const clearedTypingState = await client.clearGroupTyping(
      "token-1",
      "group-1",
      "thread-1",
    );

    expect(typingState?.threadId).toBe("thread-1");
    expect(typingState?.typers[0]?.user.id).toBe("user-1");
    expect(clearedTypingState?.typers).toEqual([]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/aerochat.chat.v1.ChatService/SetGroupTyping",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
        body: JSON.stringify({
          groupId: "group-1",
          threadId: "thread-1",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/aerochat.chat.v1.ChatService/ClearGroupTyping",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
        body: JSON.stringify({
          groupId: "group-1",
          threadId: "thread-1",
        }),
      }),
    );
  });

  it("sets direct chat typing through gateway chat endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          typingState: {
            selfTyping: {
              updatedAt: "2026-04-07T12:00:00Z",
              expiresAt: "2026-04-07T12:00:06Z",
            },
            peerTyping: {
              updatedAt: "2026-04-07T11:59:59Z",
              expiresAt: "2026-04-07T12:00:05Z",
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
    );
    const client = createGatewayClient(fetchMock, "/api");

    const typingState = await client.setDirectChatTyping("token-1", "chat-1");

    expect(typingState?.selfTyping?.updatedAt).toBe("2026-04-07T12:00:00Z");
    expect(typingState?.peerTyping?.updatedAt).toBe("2026-04-07T11:59:59Z");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/aerochat.chat.v1.ChatService/SetDirectChatTyping",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
        body: JSON.stringify({
          chatId: "chat-1",
        }),
      }),
    );
  });

  it("clears direct chat typing through gateway chat endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          typingState: {
            peerTyping: {
              updatedAt: "2026-04-07T11:59:59Z",
              expiresAt: "2026-04-07T12:00:05Z",
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
    );
    const client = createGatewayClient(fetchMock, "/api");

    const typingState = await client.clearDirectChatTyping("token-1", "chat-1");

    expect(typingState?.selfTyping).toBeNull();
    expect(typingState?.peerTyping?.updatedAt).toBe("2026-04-07T11:59:59Z");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/aerochat.chat.v1.ChatService/ClearDirectChatTyping",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
        body: JSON.stringify({
          chatId: "chat-1",
        }),
      }),
    );
  });

  it("clears direct chat presence through gateway chat endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          presenceState: {
            peerPresence: {
              heartbeatAt: "2026-04-06T11:59:58Z",
              expiresAt: "2026-04-06T12:00:28Z",
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
    );
    const client = createGatewayClient(fetchMock, "/api");

    const presenceState = await client.clearDirectChatPresence("token-1", "chat-1");

    expect(presenceState?.selfPresence).toBeNull();
    expect(presenceState?.peerPresence?.heartbeatAt).toBe("2026-04-06T11:59:58Z");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/aerochat.chat.v1.ChatService/ClearDirectChatPresence",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
        body: JSON.stringify({
          chatId: "chat-1",
        }),
      }),
    );
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
                attachments: [
                  {
                    id: "attachment-1",
                    ownerUserId: "user-1",
                    scope: "ATTACHMENT_SCOPE_DIRECT_CHAT",
                    directChatId: "chat-1",
                    fileName: "report.pdf",
                    mimeType: "application/pdf",
                    sizeBytes: 2048,
                    status: "ATTACHMENT_STATUS_ATTACHED",
                    createdAt: "2026-03-25T10:06:00Z",
                    updatedAt: "2026-03-25T10:06:00Z",
                  },
                ],
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
                attachments: [],
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
        attachments: [
          expect.objectContaining({
            id: "attachment-1",
            fileName: "report.pdf",
          }),
        ],
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

  it("calls SearchMessages through gateway chat endpoint and normalizes compact hits", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              scope: "MESSAGE_SEARCH_SCOPE_KIND_DIRECT",
              directChatId: "chat-1",
              messageId: "message-1",
              author: {
                id: "user-2",
                login: "bob",
                nickname: "Bob",
              },
              createdAt: "2026-03-21T10:00:00Z",
              editedAt: "2026-03-21T10:05:00Z",
              matchFragment: "release notes fragment",
              position: {
                messageId: "message-1",
                messageCreatedAt: "2026-03-21T10:00:00Z",
              },
            },
          ],
          nextPageCursor: {
            messageId: "message-2",
            messageCreatedAt: "2026-03-21T09:59:00Z",
          },
          hasMore: true,
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

    const page = await client.searchMessages("token-1", {
      query: "  release notes  ",
      scope: {
        kind: "direct",
      },
      pageSize: 20,
    });

    expect(page).toEqual({
      results: [
        {
          scope: "direct",
          directChatId: "chat-1",
          groupId: null,
          groupThreadId: null,
          messageId: "message-1",
          author: {
            id: "user-2",
            login: "bob",
            nickname: "Bob",
            avatarUrl: null,
          },
          createdAt: "2026-03-21T10:00:00Z",
          editedAt: "2026-03-21T10:05:00Z",
          matchFragment: "release notes fragment",
          position: {
            messageId: "message-1",
            messageCreatedAt: "2026-03-21T10:00:00Z",
          },
        },
      ],
      nextPageCursor: {
        messageId: "message-2",
        messageCreatedAt: "2026-03-21T09:59:00Z",
      },
      hasMore: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/aerochat.chat.v1.ChatService/SearchMessages",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
        body: JSON.stringify({
          query: "release notes",
          directScope: {
            chatId: "",
          },
          pageSize: 20,
        }),
      }),
    );
  });
});
