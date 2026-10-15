export class AttachmentUploadAbortedError extends Error {
  constructor() {
    super("upload aborted");
    this.name = "AttachmentUploadAbortedError";
  }
}

interface UploadFileWithProgressInput {
  body: Blob | ArrayBuffer;
  uploadUrl: string;
  httpMethod: string;
  headers: Record<string, string>;
  formFields: Record<string, string>;
  onProgress(progress: number): void;
  signal?: AbortSignal;
}

export function uploadFileWithProgress({
  body,
  uploadUrl,
  httpMethod,
  headers,
  formFields,
  onProgress,
  signal,
}: UploadFileWithProgressInput): Promise<void> {
  return new Promise((resolve, reject) => {
    if (httpMethod !== "POST" || !formFields?.policy || !formFields.key) {
      reject(new Error("upload requires a bounded POST policy"));
      return;
    }
    if (signal?.aborted) {
      reject(new AttachmentUploadAbortedError());
      return;
    }
    if (Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
      reject(new Error("multipart Content-Type must be set by the browser"));
      return;
    }
    const form = new FormData();
    for (const [name, value] of Object.entries(formFields)) {
      form.append(name, value);
    }
    form.append("file", body instanceof Blob ? body : new Blob([body]), "ciphertext.bin");
    const request = new XMLHttpRequest();
    request.open(httpMethod, uploadUrl, true);

    for (const [headerName, headerValue] of Object.entries(headers)) {
      request.setRequestHeader(headerName, headerValue);
    }

    const abort = () => request.abort();
    const settle = (error?: Error) => {
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) {
        return;
      }

      onProgress((event.loaded / event.total) * 100);
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        settle();
        return;
      }

      settle(new Error(`upload failed with status ${request.status}`));
    };

    request.onerror = () => {
      settle(new Error("upload failed"));
    };

    request.onabort = () => {
      settle(new AttachmentUploadAbortedError());
    };

    if (signal) {
      signal.addEventListener("abort", abort, { once: true });
    }

    try {
      request.send(form);
    } catch (error) {
      settle(error instanceof Error ? error : new Error("upload failed"));
    }
  });
}
