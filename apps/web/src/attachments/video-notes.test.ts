import { describe, expect, it } from "vitest";
import {
  buildVideoNoteFileName,
  resolvePreferredVideoNoteMimeType,
  resolveRecordedVideoNoteMimeType,
  resolveVideoNoteCaptureErrorMessage,
  resolveVideoNoteRecordingAvailability,
  resolveVideoNoteStartErrorMessage,
  shouldRetryVideoOnlyCapture,
} from "./video-notes";

describe("video note helpers", () => {
  it("reports unsupported camera capture environments explicitly", () => {
    expect(
      resolveVideoNoteRecordingAvailability({
        mediaDevices: null,
        MediaRecorder: null,
      }),
    ).toEqual({
      isSupported: false,
      message:
        "Видео заметки недоступны: браузер не даёт доступ к захвату камеры.",
    });

    expect(
      resolveVideoNoteRecordingAvailability({
        mediaDevices: {
          getUserMedia() {
            return Promise.resolve();
          },
        },
        MediaRecorder: null,
      }),
    ).toEqual({
      isSupported: false,
      message:
        "Видео заметки недоступны: браузер не поддерживает MediaRecorder.",
    });
  });

  it("chooses the first supported conservative video MIME", () => {
    expect(
      resolvePreferredVideoNoteMimeType({
        isTypeSupported(mimeType) {
          return mimeType === "video/webm";
        },
      }),
    ).toBe("video/webm");

    expect(resolvePreferredVideoNoteMimeType(null)).toBeNull();
  });

  it("normalizes recorded MIME candidates and falls back to video/webm", () => {
    expect(
      resolveRecordedVideoNoteMimeType("", " video/mp4 ", "video/webm"),
    ).toBe("video/mp4");
    expect(resolveRecordedVideoNoteMimeType("", undefined, null)).toBe("video/webm");
  });

  it("builds stable UTC filenames for recorded video notes", () => {
    expect(
      buildVideoNoteFileName("video/mp4", new Date("2026-03-22T14:05:09Z")),
    ).toBe("video-note-20260322-140509.mp4");
    expect(
      buildVideoNoteFileName("video/webm;codecs=vp8,opus", new Date("2026-03-22T14:05:09Z")),
    ).toBe("video-note-20260322-140509.webm");
  });

  it("retries bounded fallback to video-only only for known media capture failures", () => {
    expect(shouldRetryVideoOnlyCapture({ name: "NotAllowedError" })).toBe(true);
    expect(shouldRetryVideoOnlyCapture({ name: "NotFoundError" })).toBe(true);
    expect(shouldRetryVideoOnlyCapture({ name: "OtherError" })).toBe(false);
  });

  it("maps camera and microphone access failures to bounded Russian messages", () => {
    expect(
      resolveVideoNoteStartErrorMessage({ name: "NotAllowedError" }, "video-audio"),
    ).toBe(
      "Не удалось получить доступ к камере и микрофону. Разрешите доступ в браузере и попробуйте снова.",
    );
    expect(
      resolveVideoNoteStartErrorMessage({ name: "NotAllowedError" }, "video-only"),
    ).toBe("Доступ к камере запрещён. Разрешите его в браузере и попробуйте снова.");
    expect(
      resolveVideoNoteStartErrorMessage({ name: "NotFoundError" }, "video-only"),
    ).toBe("Не найдена доступная камера для записи видео заметки.");
    expect(
      resolveVideoNoteStartErrorMessage({ name: "UnknownError" }, "video-audio"),
    ).toBe("Не удалось начать запись видео заметки.");
  });

  it("maps recorder finalization failures conservatively", () => {
    expect(resolveVideoNoteCaptureErrorMessage({ name: "InvalidStateError" })).toBe(
      "Запись уже завершена или была остановлена слишком рано. Начните новую видео заметку.",
    );
    expect(resolveVideoNoteCaptureErrorMessage({ name: "OtherError" })).toBe(
      "Не удалось сохранить видео заметку.",
    );
  });
});
