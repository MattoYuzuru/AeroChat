const preferredVideoNoteMimeTypes = [
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
] as const;

const videoOnlyRetryErrorNames = new Set([
  "AbortError",
  "DevicesNotFoundError",
  "NotAllowedError",
  "NotFoundError",
  "NotReadableError",
  "OverconstrainedError",
  "PermissionDeniedError",
  "SecurityError",
  "TrackStartError",
  "TypeError",
]);

export type VideoNoteCaptureMode = "video-audio" | "video-only";

export interface VideoNoteRecordingEnvironment {
  mediaDevices?: {
    getUserMedia?: unknown;
  } | null;
  MediaRecorder?: {
    isTypeSupported?(mimeType: string): boolean;
  } | null;
}

export interface VideoNoteRecordingAvailability {
  isSupported: boolean;
  message: string | null;
}

export function resolveVideoNoteRecordingAvailability(
  environment: VideoNoteRecordingEnvironment,
): VideoNoteRecordingAvailability {
  if (
    environment.mediaDevices === null ||
    environment.mediaDevices === undefined ||
    typeof environment.mediaDevices.getUserMedia !== "function"
  ) {
    return {
      isSupported: false,
      message:
        "Видео заметки недоступны: браузер не даёт доступ к захвату камеры.",
    };
  }

  if (environment.MediaRecorder === null || environment.MediaRecorder === undefined) {
    return {
      isSupported: false,
      message:
        "Видео заметки недоступны: браузер не поддерживает MediaRecorder.",
    };
  }

  return {
    isSupported: true,
    message: null,
  };
}

export function resolvePreferredVideoNoteMimeType(
  mediaRecorder:
    | {
        isTypeSupported?(mimeType: string): boolean;
      }
    | null
    | undefined,
): string | null {
  if (
    mediaRecorder === null ||
    mediaRecorder === undefined ||
    typeof mediaRecorder.isTypeSupported !== "function"
  ) {
    return null;
  }

  for (const mimeType of preferredVideoNoteMimeTypes) {
    if (mediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return null;
}

export function resolveRecordedVideoNoteMimeType(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    const normalized = candidate?.trim().toLowerCase() ?? "";
    if (normalized.startsWith("video/")) {
      return normalized;
    }
  }

  return "video/webm";
}

export function buildVideoNoteFileName(
  mimeType: string,
  now: Date = new Date(),
): string {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hours = String(now.getUTCHours()).padStart(2, "0");
  const minutes = String(now.getUTCMinutes()).padStart(2, "0");
  const seconds = String(now.getUTCSeconds()).padStart(2, "0");

  return `video-note-${year}${month}${day}-${hours}${minutes}${seconds}.${resolveVideoNoteFileExtension(
    mimeType,
  )}`;
}

export function shouldRetryVideoOnlyCapture(error: unknown): boolean {
  return videoOnlyRetryErrorNames.has(resolveNamedError(error));
}

export function resolveVideoNoteStartErrorMessage(
  error: unknown,
  captureMode: VideoNoteCaptureMode,
): string {
  const errorName = resolveNamedError(error);

  switch (errorName) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return captureMode === "video-only"
        ? "Доступ к камере запрещён. Разрешите его в браузере и попробуйте снова."
        : "Не удалось получить доступ к камере и микрофону. Разрешите доступ в браузере и попробуйте снова.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return captureMode === "video-only"
        ? "Не найдена доступная камера для записи видео заметки."
        : "Не удалось найти доступную камеру или микрофон для записи видео заметки.";
    case "NotReadableError":
    case "TrackStartError":
      return captureMode === "video-only"
        ? "Камера сейчас недоступна. Завершите конфликтующее использование и попробуйте снова."
        : "Камера или микрофон сейчас недоступны. Завершите конфликтующее использование и попробуйте снова.";
    case "AbortError":
      return "Запрос к камере был прерван. Попробуйте начать запись ещё раз.";
    case "OverconstrainedError":
      return "Браузер не смог подобрать безопасную конфигурацию захвата для видео заметки.";
    case "TypeError":
      return "Браузер отклонил конфигурацию записи видео заметки.";
    default:
      return "Не удалось начать запись видео заметки.";
  }
}

export function resolveVideoNoteCaptureErrorMessage(error: unknown): string {
  const errorName = resolveNamedError(error);

  switch (errorName) {
    case "InvalidStateError":
      return "Запись уже завершена или была остановлена слишком рано. Начните новую видео заметку.";
    default:
      return "Не удалось сохранить видео заметку.";
  }
}

function resolveVideoNoteFileExtension(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();

  if (normalized.includes("mp4")) {
    return "mp4";
  }

  if (normalized.includes("quicktime")) {
    return "mov";
  }

  if (normalized.includes("matroska")) {
    return "mkv";
  }

  return "webm";
}

function resolveNamedError(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "";
  }

  if (!("name" in error) || typeof error.name !== "string") {
    return "";
  }

  return error.name;
}
