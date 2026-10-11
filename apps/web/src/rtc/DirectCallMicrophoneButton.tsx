import type { DirectCallSession } from "./useDirectCallSession";

interface DirectCallMicrophoneButtonProps {
  session: Pick<DirectCallSession,
    "isLocallyJoined" | "canToggleMicrophone" | "isMicrophoneMuted" | "toggleMicrophone"
  >;
  className?: string;
}

export function DirectCallMicrophoneButton({ session, className }: DirectCallMicrophoneButtonProps) {
  if (!session.isLocallyJoined) {
    return null;
  }

  return (
    <button
      aria-pressed={session.isMicrophoneMuted}
      className={className}
      disabled={!session.canToggleMicrophone}
      onClick={session.toggleMicrophone}
      type="button"
    >
      {session.isMicrophoneMuted ? "Включить микрофон" : "Выключить микрофон"}
    </button>
  );
}
