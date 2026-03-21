import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildVoiceNoteFileName,
  resolvePreferredVoiceNoteMimeType,
  resolveRecordedVoiceNoteMimeType,
  resolveVoiceNoteCaptureErrorMessage,
  resolveVoiceNoteRecordingAvailability,
  resolveVoiceNoteStartErrorMessage,
} from "./voice-notes";

export interface VoiceNoteDraft {
  file: File;
  fileName: string;
  mimeType: string;
  previewUrl: string;
  sizeBytes: number;
}

export interface VoiceNoteRecorderState {
  status: "idle" | "requesting_permission" | "recording" | "processing" | "recorded" | "error";
  draft: VoiceNoteDraft | null;
  errorMessage: string | null;
  supportMessage: string | null;
  isSupported: boolean;
}

interface UseVoiceNoteRecorderOptions {
  enabled: boolean;
}

export function useVoiceNoteRecorder({
  enabled,
}: UseVoiceNoteRecorderOptions) {
  const previewUrlRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sessionIdRef = useRef(0);
  const [status, setStatus] = useState<VoiceNoteRecorderState["status"]>("idle");
  const [draft, setDraft] = useState<VoiceNoteDraft | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const availability = useMemo(
    () =>
      resolveVoiceNoteRecordingAvailability({
        mediaDevices:
          typeof navigator === "undefined" ? null : navigator.mediaDevices,
        MediaRecorder:
          typeof MediaRecorder === "undefined" ? null : MediaRecorder,
      }),
    [],
  );

  async function startRecording(): Promise<boolean> {
    if (!enabled) {
      return false;
    }

    if (!availability.isSupported) {
      setStatus("error");
      setErrorMessage(availability.message);
      return false;
    }

    if (status === "requesting_permission" || status === "recording" || status === "processing") {
      return false;
    }

    resetRecorder();
    const sessionId = beginSession();
    setStatus("requesting_permission");
    setErrorMessage(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
    } catch (error) {
      if (sessionIdRef.current !== sessionId) {
        return false;
      }

      setStatus("error");
      setErrorMessage(resolveVoiceNoteStartErrorMessage(error));
      return false;
    }

    if (sessionIdRef.current !== sessionId) {
      stopMediaStream(stream);
      return false;
    }

    const preferredMimeType = resolvePreferredVoiceNoteMimeType(MediaRecorder);
    let recorder: MediaRecorder;

    try {
      recorder =
        preferredMimeType === null
          ? new MediaRecorder(stream)
          : new MediaRecorder(stream, {
              mimeType: preferredMimeType,
            });
    } catch (error) {
      stopMediaStream(stream);

      if (sessionIdRef.current !== sessionId) {
        return false;
      }

      setStatus("error");
      setErrorMessage(resolveVoiceNoteStartErrorMessage(error));
      return false;
    }

    const chunks: Blob[] = [];
    let finalized = false;

    mediaRecorderRef.current = recorder;
    mediaStreamRef.current = stream;

    recorder.addEventListener("dataavailable", (event) => {
      if (sessionIdRef.current !== sessionId || event.data.size <= 0) {
        return;
      }

      chunks.push(event.data);
    });

    recorder.addEventListener("error", (event) => {
      const recorderError = "error" in event ? event.error : null;
      finalizeFailure(sessionId, resolveVoiceNoteCaptureErrorMessage(recorderError), () => {
        finalized = true;
      }, () => finalized);
    });

    recorder.addEventListener("stop", () => {
      if (sessionIdRef.current !== sessionId || finalized) {
        return;
      }

      finalized = true;
      const mimeType = resolveRecordedVoiceNoteMimeType(
        chunks[0]?.type,
        recorder.mimeType,
        preferredMimeType,
      );
      const blob = new Blob(chunks, {
        type: mimeType,
      });

      if (blob.size <= 0) {
        finalizeFailure(sessionId, "Голосовая заметка получилась пустой. Запишите её заново.");
        return;
      }

      const file = new File([blob], buildVoiceNoteFileName(mimeType), {
        type: mimeType,
        lastModified: Date.now(),
      });
      const previewUrl = URL.createObjectURL(blob);

      replacePreviewUrl(previewUrlRef, previewUrl);
      detachActiveMedia(sessionId);
      setDraft({
        file,
        fileName: file.name,
        mimeType,
        previewUrl,
        sizeBytes: file.size,
      });
      setStatus("recorded");
      setErrorMessage(null);
    });

    try {
      recorder.start();
    } catch (error) {
      stopMediaStream(stream);
      detachActiveMedia(sessionId);
      if (sessionIdRef.current !== sessionId) {
        return false;
      }

      setStatus("error");
      setErrorMessage(resolveVoiceNoteStartErrorMessage(error));
      return false;
    }

    setDraft(null);
    setStatus("recording");
    return true;
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder === null || recorder.state !== "recording") {
      return;
    }

    setStatus("processing");
    setErrorMessage(null);

    try {
      recorder.stop();
    } catch (error) {
      finalizeFailure(
        sessionIdRef.current,
        resolveVoiceNoteCaptureErrorMessage(error),
      );
    }
  }

  function resetRecorder() {
    sessionIdRef.current += 1;
    replacePreviewUrl(previewUrlRef, null);
    forceDetachActiveMedia();
    setDraft(null);
    setErrorMessage(null);
    setStatus("idle");
  }

  function discardRecording() {
    resetRecorder();
  }

  function beginSession(): number {
    sessionIdRef.current += 1;
    replacePreviewUrl(previewUrlRef, null);
    forceDetachActiveMedia();
    setDraft(null);
    return sessionIdRef.current;
  }

  function finalizeFailure(
    sessionId: number,
    message: string,
    markFinalized?: () => void,
    isFinalized?: () => boolean,
  ) {
    if (sessionIdRef.current !== sessionId || isFinalized?.() === true) {
      return;
    }

    markFinalized?.();
    replacePreviewUrl(previewUrlRef, null);
    detachActiveMedia(sessionId);
    setDraft(null);
    setStatus("error");
    setErrorMessage(message);
  }

  function detachActiveMedia(sessionId: number) {
    if (sessionIdRef.current !== sessionId) {
      return;
    }

    forceDetachActiveMedia();
  }

  function forceDetachActiveMedia() {
    const recorder = mediaRecorderRef.current;
    if (recorder !== null && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Ничего не делаем: teardown должен оставаться best-effort.
      }
    }

    mediaRecorderRef.current = null;
    stopMediaStream(mediaStreamRef.current);
    mediaStreamRef.current = null;
  }

  useEffect(() => {
    return () => {
      sessionIdRef.current += 1;
      replacePreviewUrl(previewUrlRef, null);
      const recorder = mediaRecorderRef.current;
      if (recorder !== null && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Ничего не делаем: teardown должен оставаться best-effort.
        }
      }
      mediaRecorderRef.current = null;
      stopMediaStream(mediaStreamRef.current);
      mediaStreamRef.current = null;
    };
  }, []);

  return {
    state: {
      status,
      draft,
      errorMessage,
      supportMessage: availability.message,
      isSupported: availability.isSupported,
    } satisfies VoiceNoteRecorderState,
    startRecording,
    stopRecording,
    discardRecording,
  };
}

function replacePreviewUrl(
  ref: { current: string | null },
  nextPreviewUrl: string | null,
) {
  if (ref.current !== null) {
    URL.revokeObjectURL(ref.current);
  }

  ref.current = nextPreviewUrl;
}

function stopMediaStream(stream: MediaStream | null) {
  if (stream === null) {
    return;
  }

  for (const track of stream.getTracks()) {
    track.stop();
  }
}
