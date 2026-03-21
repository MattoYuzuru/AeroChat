import { useEffect, useRef } from "react";
import { describeAttachmentMimeType, formatAttachmentSize } from "./metadata";
import type { VideoNoteRecorderState } from "./useVideoNoteRecorder";
import styles from "./MediaNoteRecorderPanel.module.css";

interface VideoNoteRecorderPanelProps {
  state: VideoNoteRecorderState;
  startDisabled: boolean;
  stopDisabled: boolean;
  discardDisabled: boolean;
  sendDisabled: boolean;
  isSending: boolean;
  onStart(): void;
  onStop(): void;
  onDiscard(): void;
  onSend(): void;
}

export function VideoNoteRecorderPanel({
  state,
  startDisabled,
  stopDisabled,
  discardDisabled,
  sendDisabled,
  isSending,
  onStart,
  onStop,
  onDiscard,
  onSend,
}: VideoNoteRecorderPanelProps) {
  const isRecorded = state.status === "recorded" && state.draft !== null;
  const recordedDraft = isRecorded ? state.draft : null;
  const isVideoOnlyCapture = state.captureMode === "video-only";

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <p className={styles.title}>Видео заметка</p>
          <p className={styles.hint}>
            Запись остаётся single-file draft и после отправки идёт через текущий attachment
            flow.
          </p>
        </div>

        <div className={styles.actions}>
          {(state.status === "idle" || state.status === "error") && (
            <button
              className={styles.secondaryAction}
              disabled={startDisabled || !state.isSupported}
              onClick={onStart}
              type="button"
            >
              Записать видео
            </button>
          )}

          {state.status === "recording" && (
            <button
              className={styles.primaryAction}
              disabled={stopDisabled}
              onClick={onStop}
              type="button"
            >
              Остановить запись
            </button>
          )}
        </div>
      </div>

      {!state.isSupported && state.supportMessage && (
        <p className={styles.support}>{state.supportMessage}</p>
      )}

      {state.status === "requesting_permission" && (
        <p className={styles.status}>Запрашиваем доступ к камере и микрофону...</p>
      )}

      {state.status === "recording" && (
        <p className={styles.status}>
          Идёт запись видео заметки. Остановите её, когда preview будет готов к отправке.
        </p>
      )}

      {state.status === "processing" && (
        <p className={styles.status}>Сохраняем видео заметку и готовим её к review.</p>
      )}

      {isVideoOnlyCapture && (
        <p className={styles.notice}>
          Микрофон недоступен. Видео заметка будет записана без звука.
        </p>
      )}

      {state.errorMessage && <p className={styles.error}>{state.errorMessage}</p>}

      {state.status === "recording" && state.livePreviewStream !== null && (
        <div className={styles.livePreviewCard}>
          <p className={styles.meta}>Live preview камеры</p>
          <LiveCameraPreview stream={state.livePreviewStream} />
        </div>
      )}

      {recordedDraft && (
        <div className={styles.previewCard}>
          <div>
            <p className={styles.title}>{recordedDraft.fileName}</p>
            <p className={styles.meta}>
              {formatAttachmentSize(recordedDraft.sizeBytes)} •{" "}
              {describeAttachmentMimeType(recordedDraft.mimeType)}
            </p>
          </div>

          <video
            aria-label={`Предпросмотр ${recordedDraft.fileName}`}
            className={styles.videoPreview}
            controls
            playsInline
            preload="metadata"
            src={recordedDraft.previewUrl}
          />

          <div className={styles.actions}>
            <button
              className={styles.ghostAction}
              disabled={discardDisabled}
              onClick={onDiscard}
              type="button"
            >
              Убрать запись
            </button>
            <button
              className={styles.primaryAction}
              disabled={sendDisabled}
              onClick={onSend}
              type="button"
            >
              {isSending ? "Отправляем видео..." : "Отправить видео"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function LiveCameraPreview({
  stream,
}: {
  stream: MediaStream;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const node = videoRef.current;
    if (node === null) {
      return;
    }

    node.srcObject = stream;

    return () => {
      if (node.srcObject === stream) {
        node.srcObject = null;
      }
    };
  }, [stream]);

  return (
    <video
      aria-label="Live preview видео заметки"
      autoPlay
      className={styles.livePreview}
      muted
      playsInline
      ref={videoRef}
    />
  );
}
