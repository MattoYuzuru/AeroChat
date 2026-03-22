import { createGatewayClient } from "../gateway/client";
import { createBrowserCryptoKeyStore } from "./keystore";
import { createWebCryptoMaterialFactory } from "./material";
import { createCryptoRuntimeCore } from "./runtime-core";
import type {
  CryptoWorkerRequest,
  CryptoWorkerResponse,
} from "./types";

const runtime = createCryptoRuntimeCore({
  gatewayClient: createGatewayClient(globalThis.fetch.bind(globalThis)),
  keyStore: createBrowserCryptoKeyStore(),
  materialFactory: createWebCryptoMaterialFactory(),
  resolveDeviceLabel: buildCryptoDeviceLabel,
});

self.onmessage = (event: MessageEvent<CryptoWorkerRequest>) => {
  void handleRequest(event.data);
};

async function handleRequest(request: CryptoWorkerRequest) {
  try {
    let snapshot;

    switch (request.type) {
      case "bootstrap":
        snapshot = await runtime.bootstrapSession(request.payload.session);
        break;
      case "createPendingLinkedDevice":
        snapshot = await runtime.createPendingLinkedDevice(request.payload.session);
        break;
      case "publishCurrentBundle":
        snapshot = await runtime.publishCurrentBundle(request.payload.session);
        break;
      case "approveLinkIntent":
        snapshot = await runtime.approveLinkIntent(
          request.payload.session,
          request.payload.linkIntentId,
        );
        break;
      default:
        throw new Error("Неизвестная crypto worker command.");
    }

    const response: CryptoWorkerResponse = {
      id: request.id,
      ok: true,
      snapshot,
    };
    self.postMessage(response);
  } catch (error) {
    const response: CryptoWorkerResponse = {
      id: request.id,
      ok: false,
      message:
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : "Crypto worker завершился с ошибкой.",
    };
    self.postMessage(response);
  }
}

function buildCryptoDeviceLabel(): string {
  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };
  const platform =
    typeof navigatorWithUserAgentData.userAgentData?.platform === "string" &&
    navigatorWithUserAgentData.userAgentData.platform.trim() !== ""
      ? navigatorWithUserAgentData.userAgentData.platform.trim()
      : navigator.platform?.trim() || "Browser";

  return `Web ${platform}`;
}
