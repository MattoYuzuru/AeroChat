import { describe, expect, it } from "vitest";
import {
  buildVoiceNoteFileName,
  resolvePreferredVoiceNoteMimeType,
  resolveRecordedVoiceNoteMimeType,
  resolveVoiceNoteCaptureErrorMessage,
  resolveVoiceNoteRecordingAvailability,
  resolveVoiceNoteStartErrorMessage,
} from "./voice-notes";

describe("voice note helpers", () => {
  it("reports unsupported microphone capture environments explicitly", () => {
    expect(
      resolveVoiceNoteRecordingAvailability({
        mediaDevices: null,
        MediaRecorder: null,
      }),
    ).toEqual({
      isSupported: false,
      message:
        "Голосовые заметки недоступны: браузер не даёт доступ к захвату микрофона.",
    });

    expect(
      resolveVoiceNoteRecordingAvailability({
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
        "Голосовые заметки недоступны: браузер не поддерживает MediaRecorder.",
    });
  });

  it("chooses the first supported conservative audio MIME", () => {
    expect(
      resolvePreferredVoiceNoteMimeType({
        isTypeSupported(mimeType) {
          return mimeType === "audio/ogg";
        },
      }),
    ).toBe("audio/ogg");

    expect(resolvePreferredVoiceNoteMimeType(null)).toBeNull();
  });

  it("normalizes recorded MIME candidates and falls back to audio/webm", () => {
    expect(
      resolveRecordedVoiceNoteMimeType("", " audio/ogg ", "audio/webm"),
    ).toBe("audio/ogg");
    expect(resolveRecordedVoiceNoteMimeType("", undefined, null)).toBe("audio/webm");
  });

  it("builds stable UTC filenames for recorded voice notes", () => {
    expect(
      buildVoiceNoteFileName("audio/mp4", new Date("2026-03-22T14:05:09Z")),
    ).toBe("voice-note-20260322-140509.m4a");
    expect(
      buildVoiceNoteFileName("audio/webm;codecs=opus", new Date("2026-03-22T14:05:09Z")),
    ).toBe("voice-note-20260322-140509.webm");
  });

  it("maps microphone access failures to bounded Russian messages", () => {
    expect(resolveVoiceNoteStartErrorMessage({ name: "NotAllowedError" })).toBe(
      "Доступ к микрофону запрещён. Разрешите его в браузере и попробуйте снова.",
    );
    expect(resolveVoiceNoteStartErrorMessage({ name: "NotFoundError" })).toBe(
      "Не найден доступный микрофон для записи голосовой заметки.",
    );
    expect(resolveVoiceNoteStartErrorMessage({ name: "UnknownError" })).toBe(
      "Не удалось начать запись голосовой заметки.",
    );
  });

  it("maps recorder finalization failures conservatively", () => {
    expect(resolveVoiceNoteCaptureErrorMessage({ name: "InvalidStateError" })).toBe(
      "Запись уже завершена или была остановлена слишком рано. Начните новую голосовую заметку.",
    );
    expect(resolveVoiceNoteCaptureErrorMessage({ name: "OtherError" })).toBe(
      "Не удалось сохранить голосовую заметку.",
    );
  });
});
