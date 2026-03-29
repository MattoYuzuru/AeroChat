const rtcServicePath = "aerochat.rtc.v1.RtcControlService";

type KeepaliveFetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<unknown>;

export function buildRtcControlServicePath(baseUrl: string, method: string): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBaseUrl}/${rtcServicePath}/${method}`;
}

export function sendRtcLeaveCallKeepalive(
  token: string,
  callId: string,
  baseUrl: string,
  fetchLike: KeepaliveFetchLike | undefined = globalThis.fetch?.bind(globalThis),
): boolean {
  const normalizedToken = token.trim();
  const normalizedCallId = callId.trim();
  if (
    normalizedToken === "" ||
    normalizedCallId === "" ||
    fetchLike === undefined
  ) {
    return false;
  }

  void fetchLike(buildRtcControlServicePath(baseUrl, "LeaveCall"), {
    method: "POST",
    keepalive: true,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${normalizedToken}`,
      "Connect-Protocol-Version": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      callId: normalizedCallId,
    }),
  }).catch(() => {
    // `pagehide`/`beforeunload` cleanup идёт best-effort и не должен шуметь в консоль.
  });

  return true;
}
