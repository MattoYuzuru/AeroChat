import { createGatewayClient } from "./client";

export const gatewayClient = createGatewayClient(globalThis.fetch.bind(globalThis));
