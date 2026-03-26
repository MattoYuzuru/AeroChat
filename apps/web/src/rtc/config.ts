interface DirectCallRTCEnvironment {
  VITE_RTC_ICE_SERVER_URLS?: string;
  VITE_RTC_TURN_USERNAME?: string;
  VITE_RTC_TURN_CREDENTIAL?: string;
}

const defaultDirectCallIceServerURLs = ["stun:stun.cloudflare.com:3478"];

export function resolveDirectCallRTCConfiguration(
  environment: DirectCallRTCEnvironment,
): RTCConfiguration {
  const iceServerUrls = parseIceServerUrls(environment.VITE_RTC_ICE_SERVER_URLS);

  const turnUsername = normalizeOptionalString(environment.VITE_RTC_TURN_USERNAME);
  const turnCredential = normalizeOptionalString(environment.VITE_RTC_TURN_CREDENTIAL);

  const iceServers: RTCIceServer[] = [
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

  return { iceServers };
}

export const directCallRTCConfiguration = resolveDirectCallRTCConfiguration(
  import.meta.env as ImportMetaEnv & DirectCallRTCEnvironment,
);

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
