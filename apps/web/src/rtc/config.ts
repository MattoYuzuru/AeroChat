import type { RtcIceServer as GatewayRtcIceServer } from "../gateway/types";

interface DirectCallRTCEnvironment {
  VITE_RTC_ICE_SERVER_URLS?: string;
  VITE_RTC_TURN_USERNAME?: string;
  VITE_RTC_TURN_CREDENTIAL?: string;
}

const defaultDirectCallIceServerURLs = ["stun:stun.cloudflare.com:3478"];

export function resolveDirectCallRTCConfiguration(
  environment: DirectCallRTCEnvironment,
): RTCConfiguration {
  return buildDirectCallRTCConfiguration([], environment);
}

export function buildDirectCallRTCConfiguration(
  iceServers: readonly GatewayRtcIceServer[],
  environment: DirectCallRTCEnvironment = import.meta.env as ImportMetaEnv &
    DirectCallRTCEnvironment,
): RTCConfiguration {
  const configuredIceServers = normalizeGatewayIceServers(iceServers);
  if (configuredIceServers.length > 0) {
    return { iceServers: configuredIceServers };
  }

  return { iceServers: resolveFallbackBrowserIceServers(environment) };
}

export const directCallRTCConfiguration = resolveDirectCallRTCConfiguration(
  import.meta.env as ImportMetaEnv & DirectCallRTCEnvironment,
);

function resolveFallbackBrowserIceServers(
  environment: DirectCallRTCEnvironment,
): RTCIceServer[] {
  const iceServerUrls = parseIceServerUrls(environment.VITE_RTC_ICE_SERVER_URLS);
  const turnUsername = normalizeOptionalString(environment.VITE_RTC_TURN_USERNAME);
  const turnCredential = normalizeOptionalString(environment.VITE_RTC_TURN_CREDENTIAL);

  return [
    turnUsername !== null && turnCredential !== null
      ? {
          urls: iceServerUrls,
          username: turnUsername,
          credential: turnCredential,
        }
      : {
          urls: iceServerUrls,
        },
  ];
}

function normalizeGatewayIceServers(
  iceServers: readonly GatewayRtcIceServer[],
): RTCIceServer[] {
  const normalizedServers: RTCIceServer[] = [];
  const seenKeys = new Set<string>();

  for (const iceServer of iceServers) {
    const urls = iceServer.urls
      .map((value) => value.trim())
      .filter((value) => value !== "");
    if (urls.length === 0) {
      continue;
    }

    const username = normalizeOptionalString(iceServer.username ?? undefined);
    const credential = normalizeOptionalString(iceServer.credential ?? undefined);
    const browserIceServer: RTCIceServer =
      username !== null && credential !== null
        ? {
            urls,
            username,
            credential,
          }
        : {
            urls,
          };

    const dedupeKey = JSON.stringify({
      urls,
      username,
      credential,
    });
    if (seenKeys.has(dedupeKey)) {
      continue;
    }

    seenKeys.add(dedupeKey);
    normalizedServers.push(browserIceServer);
  }

  return normalizedServers;
}

function parseIceServerUrls(value: string | undefined): string[] {
  const urls = value
    ?.split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item !== "");

  return urls !== undefined && urls.length > 0 ? urls : defaultDirectCallIceServerURLs;
}

function normalizeOptionalString(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}
