import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentUploadAbortedError, uploadFileWithProgress } from "./upload";

class FakeRequest {
  static instances: FakeRequest[] = [];
  status = 204;
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn<(body: FormData) => void>();
  abort = vi.fn(() => this.onabort?.());
  constructor() { FakeRequest.instances.push(this); }
}

const input = () => ({
  body: new Uint8Array([1, 2, 3]).buffer,
  uploadUrl: "http://localhost:29000/fixture",
  httpMethod: "POST",
  headers: {},
  formFields: { key: "staging/fixture.bin", policy: "signed-policy", "Content-Type": "application/octet-stream" },
  onProgress: vi.fn(),
});

function requestAt(index: number): FakeRequest {
  const request = FakeRequest.instances[index];
  if (!request) throw new Error("expected an upload request");
  return request;
}

describe("bounded attachment upload", () => {
  beforeEach(() => { FakeRequest.instances = []; vi.stubGlobal("XMLHttpRequest", FakeRequest); });
  afterEach(() => vi.unstubAllGlobals());

  it("sends every signed field before the ciphertext file without a manual multipart header", async () => {
    const options = input();
    const promise = uploadFileWithProgress(options);
    const request = requestAt(0);
    expect(request.open).toHaveBeenCalledWith("POST", options.uploadUrl, true);
    expect(request.setRequestHeader).not.toHaveBeenCalled();
    const form = request.send.mock.calls[0]?.[0];
    if (!form) throw new Error("expected a multipart body");
    expect(Array.from(form.keys())).toEqual(["key", "policy", "Content-Type", "file"]);
    expect(form.get("policy")).toBe("signed-policy");
    expect((form.get("file") as Blob).size).toBe(3);
    request.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 } as ProgressEvent);
    expect(options.onProgress).toHaveBeenCalledWith(50);
    request.onload?.();
    await promise;
  });

  it.each([
    { httpMethod: "PUT" },
    { formFields: { key: "staging/fixture.bin" } },
    { headers: { "Content-Type": "multipart/form-data" } },
  ])("rejects an unbounded or malformed capability before creating a request: %o", async (override) => {
    await expect(uploadFileWithProgress({ ...input(), ...override })).rejects.toThrow();
    expect(FakeRequest.instances).toHaveLength(0);
  });

  it("rejects an already cancelled upload without sending bytes", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(uploadFileWithProgress({ ...input(), signal: controller.signal })).rejects.toBeInstanceOf(AttachmentUploadAbortedError);
    expect(FakeRequest.instances).toHaveLength(0);
  });

  it("aborts an active upload and removes the listener on completion", async () => {
    const controller = new AbortController();
    const cancelled = uploadFileWithProgress({ ...input(), signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toBeInstanceOf(AttachmentUploadAbortedError);
    expect(requestAt(0).abort).toHaveBeenCalledOnce();
    const completedController = new AbortController();
    const completed = uploadFileWithProgress({ ...input(), signal: completedController.signal });
    const request = requestAt(1);
    request.onload?.();
    await completed;
    completedController.abort();
    expect(request.abort).not.toHaveBeenCalled();
  });

  it.each([400, 403, 500])("surfaces storage rejection %i", async (status) => {
    const pending = uploadFileWithProgress(input());
    const request = requestAt(0);
    request.status = status;
    request.onload?.();
    await expect(pending).rejects.toThrow(`status ${status}`);
  });
});
