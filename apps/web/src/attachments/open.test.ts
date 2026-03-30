import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gatewayClient } from "../gateway/runtime";
import type { AttachmentAccess } from "../gateway/types";
import { openAttachmentInNewTab, openUrlInNewTab } from "./open";

vi.mock("../gateway/runtime", () => ({
  gatewayClient: {
    getAttachment: vi.fn(),
  },
}));

describe("attachment open helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens a detached anchor in a new tab without touching the current page", () => {
    const anchor = createAnchorStub();
    const append = vi.fn();
    const createElement = vi.fn(() => anchor);

    vi.stubGlobal("document", {
      body: {
        append,
      },
      createElement,
    });

    openUrlInNewTab("https://cdn.example/media.jpg");

    expect(createElement).toHaveBeenCalledWith("a");
    expect(anchor.href).toBe("https://cdn.example/media.jpg");
    expect(anchor.target).toBe("_blank");
    expect(anchor.rel).toBe("noopener noreferrer");
    expect(append).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(anchor.remove).toHaveBeenCalledTimes(1);
  });

  it("reuses the detached anchor path for attachment access URLs", async () => {
    const access: AttachmentAccess = {
      attachment: {
        id: "attachment-7",
        ownerUserId: "user-1",
        scope: "direct",
        directChatId: "chat-1",
        groupId: null,
        messageId: "message-1",
        fileName: "report.pdf",
        mimeType: "application/pdf",
        relaySchema: "ATTACHMENT_RELAY_SCHEMA_LEGACY_PLAINTEXT",
        sizeBytes: 1024,
        status: "attached",
        createdAt: "2026-03-30T08:00:00Z",
        updatedAt: "2026-03-30T08:00:00Z",
        uploadedAt: "2026-03-30T08:00:00Z",
        attachedAt: "2026-03-30T08:00:00Z",
        failedAt: null,
        deletedAt: null,
      },
      downloadUrl: "https://cdn.example/report.pdf",
      downloadExpiresAt: "2026-03-30T09:00:00Z",
    };

    vi.mocked(gatewayClient.getAttachment).mockResolvedValue(access);

    const anchor = createAnchorStub();
    const append = vi.fn();

    vi.stubGlobal("document", {
      body: {
        append,
      },
      createElement: vi.fn(() => anchor),
    });

    await openAttachmentInNewTab("token-1", "attachment-7");

    expect(gatewayClient.getAttachment).toHaveBeenCalledWith("token-1", "attachment-7");
    expect(anchor.href).toBe("https://cdn.example/report.pdf");
    expect(anchor.target).toBe("_blank");
    expect(anchor.click).toHaveBeenCalledTimes(1);
  });
});

function createAnchorStub() {
  return {
    click: vi.fn(),
    href: "",
    rel: "",
    remove: vi.fn(),
    style: {
      display: "",
    },
    target: "",
  };
}
