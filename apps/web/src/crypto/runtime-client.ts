import type {
  CryptoRuntimeClient,
  CryptoRuntimeSession,
  CryptoWorkerRequest,
  CryptoWorkerRequestMap,
  CryptoWorkerResultMap,
  CryptoWorkerResponse,
} from "./types";

export function createCryptoRuntimeClient(): CryptoRuntimeClient {
  const worker = new Worker(
    new URL("./runtime-worker.ts", import.meta.url),
    { type: "module" },
  );
  let nextRequestID = 1;
  const pending = new Map<
    number,
    {
      resolve(result: unknown): void;
      reject(error: Error): void;
    }
  >();

  worker.onmessage = (event: MessageEvent<CryptoWorkerResponse>) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (request === undefined) {
      return;
    }

    pending.delete(response.id);
    if (response.ok) {
      request.resolve(response.result);
      return;
    }

    request.reject(new Error(response.message));
  };

  worker.onerror = (event) => {
    const error = new Error(event.message || "Crypto worker crashed.");
    for (const request of pending.values()) {
      request.reject(error);
    }
    pending.clear();
  };

  function sendCommand<TType extends keyof CryptoWorkerRequestMap>(
    type: TType,
    payload: CryptoWorkerRequestMap[TType],
  ): Promise<CryptoWorkerResultMap[TType]> {
    const id = nextRequestID++;
    const request = {
      id,
      type,
      payload,
    } as CryptoWorkerRequest;

    return new Promise((resolve, reject) => {
      pending.set(id, {
        resolve(result) {
          resolve(result as CryptoWorkerResultMap[TType]);
        },
        reject,
      });
      worker.postMessage(request);
    });
  }

  return {
    bootstrapSession(session: CryptoRuntimeSession) {
      return sendCommand("bootstrap", { session });
    },
    createPendingLinkedDevice(session: CryptoRuntimeSession) {
      return sendCommand("createPendingLinkedDevice", { session });
    },
    publishCurrentBundle(session: CryptoRuntimeSession) {
      return sendCommand("publishCurrentBundle", { session });
    },
    approveLinkIntent(session: CryptoRuntimeSession, linkIntentId: string) {
      return sendCommand("approveLinkIntent", { session, linkIntentId });
    },
    decryptEncryptedDirectMessageV2Envelopes(session, envelopes) {
      return sendCommand("decryptEncryptedDirectMessageV2Envelopes", {
        session,
        envelopes,
      });
    },
    dispose() {
      for (const request of pending.values()) {
        request.reject(new Error("Crypto runtime client disposed."));
      }
      pending.clear();
      worker.terminate();
    },
  };
}
