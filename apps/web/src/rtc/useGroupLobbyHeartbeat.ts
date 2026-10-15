import { useEffect, useEffectEvent } from "react";
import { gatewayClient } from "../gateway/runtime";
import { startGroupLobbyHeartbeat } from "./group-lobby-heartbeat";

export function useGroupLobbyHeartbeat(options: {
  token: string;
  callId: string | null;
  pageVisible: boolean;
  onSuccess(): void;
  onFailure(error: unknown): void;
}) {
  const onSuccess = useEffectEvent(options.onSuccess);
  const onFailure = useEffectEvent(options.onFailure);
  const { token, callId, pageVisible } = options;
  useEffect(() => {
    if (token === "" || callId === null || !pageVisible) return;
    return startGroupLobbyHeartbeat({
      touch: () => gatewayClient.touchCallParticipant(token, callId),
      onSuccess,
      onFailure,
    });
  }, [token, callId, pageVisible]);
}
