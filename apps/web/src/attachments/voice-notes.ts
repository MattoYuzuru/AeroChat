const preferredVoiceNoteMimeTypes = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
] as const;

export interface VoiceNoteRecordingEnvironment {
  mediaDevices?: {
    getUserMedia?: unknown;
  } | null;
  MediaRecorder?: {
    isTypeSupported?(mimeType: string): boolean;
  } | null;
}

export interface VoiceNoteRecordingAvailability {
  isSupported: boolean;
  message: string | null;
}

export function resolveVoiceNoteRecordingAvailability(
  environment: VoiceNoteRecordingEnvironment,
): VoiceNoteRecordingAvailability {
  if (
    environment.mediaDevices === null ||
    environment.mediaDevices === undefined ||
    typeof environment.mediaDevices.getUserMedia !== "function"
  ) {
    return {
      isSupported: false,
      message:
        "Голосовые заметки недоступны: браузер не даёт доступ к захвату микрофона.",
    };
  }

  if (environment.MediaRecorder === null || environment.MediaRecorder === undefined) {
    return {
      isSupported: false,
      message:
        "Голосовые заметки недоступны: браузер не поддерживает MediaRecorder.",
    };
  }

  return {
    isSupported: true,
    message: null,
  };
}

export function resolvePreferredVoiceNoteMimeType(
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

  for (const mimeType of preferredVoiceNoteMimeTypes) {
    if (mediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return null;
}

export function resolveRecordedVoiceNoteMimeType(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    const normalized = candidate?.trim().toLowerCase() ?? "";
    if (normalized.startsWith("audio/")) {
      return normalized;
    }
  }

  return "audio/webm";
}

export function buildVoiceNoteFileName(
  mimeType: string,
  now: Date = new Date(),
): string {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hours = String(now.getUTCHours()).padStart(2, "0");
  const minutes = String(now.getUTCMinutes()).padStart(2, "0");
  const seconds = String(now.getUTCSeconds()).padStart(2, "0");

  return `voice-note-${year}${month}${day}-${hours}${minutes}${seconds}.${resolveVoiceNoteFileExtension(
    mimeType,
  )}`;
}

export function resolveVoiceNoteStartErrorMessage(error: unknown): string {
  const errorName = resolveNamedError(error);

  switch (errorName) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "Доступ к микрофону запрещён. Разрешите его в браузере и попробуйте снова.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "Не найден доступный микрофон для записи голосовой заметки.";
    case "NotReadableError":
    case "TrackStartError":
      return "Микрофон сейчас недоступен. Завершите конфликтующее использование и попробуйте снова.";
    case "AbortError":
      return "Запрос к микрофону был прерван. Попробуйте начать запись ещё раз.";
    case "TypeError":
      return "Браузер отклонил конфигурацию записи. Проверьте поддержку голосовых заметок.";
    default:
      return "Не удалось начать запись голосовой заметки.";
  }
}

export function resolveVoiceNoteCaptureErrorMessage(error: unknown): string {
  const errorName = resolveNamedError(error);

  switch (errorName) {
    case "InvalidStateError":
      return "Запись уже завершена или была остановлена слишком рано. Начните новую голосовую заметку.";
    default:
      return "Не удалось сохранить голосовую заметку.";
  }
}

function resolveVoiceNoteFileExtension(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();

  if (normalized.includes("ogg")) {
    return "ogg";
  }

  if (normalized.includes("mp4") || normalized.includes("m4a")) {
    return "m4a";
  }

  if (normalized.includes("mpeg") || normalized.includes("mp3")) {
    return "mp3";
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
