import { describeAttachmentMimeType, formatAttachmentSize } from "./metadata";
import type { VoiceNoteRecorderState } from "./useVoiceNoteRecorder";
import styles from "./VoiceNoteRecorderPanel.module.css";

interface VoiceNoteRecorderPanelProps {
  state: VoiceNoteRecorderState;
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

export function VoiceNoteRecorderPanel({
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
}: VoiceNoteRecorderPanelProps) {
  const isRecorded = state.status === "recorded" && state.draft !== null;
  const recordedDraft = isRecorded ? state.draft : null;

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <p className={styles.title}>Голосовая заметка</p>
          <p className={styles.hint}>
            Запись остаётся single-file draft и после отправки идёт через текущий attachment flow.
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
              Записать голосовое
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
        <p className={styles.status}>Запрашиваем доступ к микрофону...</p>
      )}

      {state.status === "recording" && (
        <p className={styles.status}>Идёт запись с микрофона. Остановите её, когда заметка будет готова.</p>
      )}

      {state.status === "processing" && (
        <p className={styles.status}>Сохраняем голосовую заметку и готовим её к review.</p>
      )}

      {state.errorMessage && <p className={styles.error}>{state.errorMessage}</p>}

      {recordedDraft && (
        <div className={styles.previewCard}>
          <div>
            <p className={styles.title}>{recordedDraft.fileName}</p>
            <p className={styles.meta}>
              {formatAttachmentSize(recordedDraft.sizeBytes)} •{" "}
              {describeAttachmentMimeType(recordedDraft.mimeType)}
            </p>
          </div>

          <audio
            aria-label={`Предпрослушивание ${recordedDraft.fileName}`}
            className={styles.player}
            controls
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
              {isSending ? "Отправляем запись..." : "Отправить запись"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
