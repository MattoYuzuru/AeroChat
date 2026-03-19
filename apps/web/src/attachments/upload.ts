export class AttachmentUploadAbortedError extends Error {
  constructor() {
    super("upload aborted");
    this.name = "AttachmentUploadAbortedError";
  }
}

interface UploadFileWithProgressInput {
  file: File;
  uploadUrl: string;
  httpMethod: string;
  headers: Record<string, string>;
  onProgress(progress: number): void;
  signal?: AbortSignal;
}

export function uploadFileWithProgress({
  file,
  uploadUrl,
  httpMethod,
  headers,
  onProgress,
  signal,
}: UploadFileWithProgressInput): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(httpMethod, uploadUrl, true);

    for (const [headerName, headerValue] of Object.entries(headers)) {
      request.setRequestHeader(headerName, headerValue);
    }

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) {
        return;
      }

      onProgress((event.loaded / event.total) * 100);
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }

      reject(new Error(`upload failed with status ${request.status}`));
    };

    request.onerror = () => {
      reject(new Error("upload failed"));
    };

    request.onabort = () => {
      reject(new AttachmentUploadAbortedError());
    };

    if (signal) {
      if (signal.aborted) {
        request.abort();
        return;
      }

      signal.addEventListener(
        "abort",
        () => {
          request.abort();
        },
        { once: true },
      );
    }

    request.send(file);
  });
}
