import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildVideoNoteFileName,
  resolvePreferredVideoNoteMimeType,
  resolveRecordedVideoNoteMimeType,
  resolveVideoNoteCaptureErrorMessage,
  resolveVideoNoteRecordingAvailability,
  resolveVideoNoteStartErrorMessage,
  shouldRetryVideoOnlyCapture,
  type VideoNoteCaptureMode,
} from "./video-notes";

export interface VideoNoteDraft {
  file: File;
  fileName: string;
  mimeType: string;
  previewUrl: string;
  sizeBytes: number;
  captureMode: VideoNoteCaptureMode;
}

export interface VideoNoteRecorderState {
  status: "idle" | "requesting_permission" | "recording" | "processing" | "recorded" | "error";
  draft: VideoNoteDraft | null;
  errorMessage: string | null;
  supportMessage: string | null;
  isSupported: boolean;
  captureMode: VideoNoteCaptureMode | null;
  livePreviewStream: MediaStream | null;
}

interface UseVideoNoteRecorderOptions {
  enabled: boolean;
}

interface VideoNoteCaptureFailure {
  error: unknown;
  captureMode: VideoNoteCaptureMode;
}

export function useVideoNoteRecorder({
  enabled,
}: UseVideoNoteRecorderOptions) {
  const previewUrlRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sessionIdRef = useRef(0);
  const [status, setStatus] = useState<VideoNoteRecorderState["status"]>("idle");
  const [draft, setDraft] = useState<VideoNoteDraft | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [captureMode, setCaptureMode] = useState<VideoNoteCaptureMode | null>(null);
  const [livePreviewStream, setLivePreviewStream] = useState<MediaStream | null>(null);

  const availability = useMemo(
    () =>
      resolveVideoNoteRecordingAvailability({
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
    let nextCaptureMode: VideoNoteCaptureMode;
    try {
      const capture = await requestCaptureStream();
      stream = capture.stream;
      nextCaptureMode = capture.captureMode;
    } catch (captureError) {
      if (sessionIdRef.current !== sessionId) {
        return false;
      }

      const normalizedCaptureError = normalizeCaptureFailure(captureError);
      setStatus("error");
      setCaptureMode(null);
      setErrorMessage(
        resolveVideoNoteStartErrorMessage(
          normalizedCaptureError.error,
          normalizedCaptureError.captureMode,
        ),
      );
      return false;
    }

    if (sessionIdRef.current !== sessionId) {
      stopMediaStream(stream);
      return false;
    }

    const preferredMimeType = resolvePreferredVideoNoteMimeType(MediaRecorder);
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
      setCaptureMode(null);
      setErrorMessage(resolveVideoNoteStartErrorMessage(error, nextCaptureMode));
      return false;
    }

    const chunks: Blob[] = [];
    let finalized = false;

    mediaRecorderRef.current = recorder;
    mediaStreamRef.current = stream;
    setCaptureMode(nextCaptureMode);
    setLivePreviewStream(stream);

    recorder.addEventListener("dataavailable", (event) => {
      if (sessionIdRef.current !== sessionId || event.data.size <= 0) {
        return;
      }

      chunks.push(event.data);
    });

    recorder.addEventListener("error", (event) => {
      const recorderError = "error" in event ? event.error : null;
      finalizeFailure(sessionId, resolveVideoNoteCaptureErrorMessage(recorderError), () => {
        finalized = true;
      }, () => finalized);
    });

    recorder.addEventListener("stop", () => {
      if (sessionIdRef.current !== sessionId || finalized) {
        return;
      }

      finalized = true;
      const mimeType = resolveRecordedVideoNoteMimeType(
        chunks[0]?.type,
        recorder.mimeType,
        preferredMimeType,
      );
      const blob = new Blob(chunks, {
        type: mimeType,
      });

      if (blob.size <= 0) {
        finalizeFailure(sessionId, "Видео заметка получилась пустой. Запишите её заново.");
        return;
      }

      const file = new File([blob], buildVideoNoteFileName(mimeType), {
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
        captureMode: nextCaptureMode,
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
      setCaptureMode(null);
      setErrorMessage(resolveVideoNoteStartErrorMessage(error, nextCaptureMode));
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
        resolveVideoNoteCaptureErrorMessage(error),
      );
    }
  }

  function resetRecorder() {
    sessionIdRef.current += 1;
    replacePreviewUrl(previewUrlRef, null);
    forceDetachActiveMedia();
    setDraft(null);
    setErrorMessage(null);
    setCaptureMode(null);
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
    setCaptureMode(null);
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
    setCaptureMode(null);
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
    setLivePreviewStream(null);
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

  async function requestCaptureStream(): Promise<{
    stream: MediaStream;
    captureMode: VideoNoteCaptureMode;
  }> {
    try {
      return {
        stream: await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
          },
          audio: true,
        }),
        captureMode: "video-audio",
      };
    } catch (error) {
      if (!shouldRetryVideoOnlyCapture(error)) {
        throw {
          error,
          captureMode: "video-audio",
        } satisfies VideoNoteCaptureFailure;
      }
    }

    try {
      return {
        stream: await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
          },
          audio: false,
        }),
        captureMode: "video-only",
      };
    } catch (fallbackError) {
      throw {
        error: fallbackError,
        captureMode: "video-only",
      } satisfies VideoNoteCaptureFailure;
    }
  }

  return {
    state: {
      status,
      draft,
      errorMessage,
      supportMessage: availability.message,
      isSupported: availability.isSupported,
      captureMode,
      livePreviewStream,
    } satisfies VideoNoteRecorderState,
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

function normalizeCaptureFailure(error: unknown): VideoNoteCaptureFailure {
  if (
    typeof error === "object" &&
    error !== null &&
    "captureMode" in error &&
    (error.captureMode === "video-audio" || error.captureMode === "video-only") &&
    "error" in error
  ) {
    return {
      error: error.error,
      captureMode: error.captureMode,
    };
  }

  return {
    error,
    captureMode: "video-audio",
  };
}
