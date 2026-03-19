export type AttachmentDisplayCategory =
  | "image"
  | "audio"
  | "video"
  | "document"
  | "archive-binary"
  | "generic-file";

export interface AttachmentDisplayDescriptor {
  category: AttachmentDisplayCategory;
  badgeLabel: string;
  categoryLabel: string;
  mimeLabel: string;
}

const DOCUMENT_MIME_TYPES = new Set([
  "application/json",
  "application/msword",
  "application/pdf",
  "application/rtf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/markdown",
  "text/plain",
]);

const ARCHIVE_BINARY_MIME_TYPES = new Set([
  "application/gzip",
  "application/java-archive",
  "application/octet-stream",
  "application/vnd.android.package-archive",
  "application/x-7z-compressed",
  "application/x-apple-diskimage",
  "application/x-bzip2",
  "application/x-executable",
  "application/x-rar-compressed",
  "application/x-tar",
  "application/zip",
]);

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "png",
  "webp",
]);

const AUDIO_EXTENSIONS = new Set([
  "aac",
  "flac",
  "m4a",
  "mp3",
  "ogg",
  "opus",
  "wav",
  "weba",
]);

const VIDEO_EXTENSIONS = new Set([
  "avi",
  "m4v",
  "mkv",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "webm",
]);

const DOCUMENT_EXTENSIONS = new Set([
  "csv",
  "doc",
  "docx",
  "json",
  "md",
  "ods",
  "odt",
  "pdf",
  "ppt",
  "pptx",
  "rtf",
  "txt",
  "xls",
  "xlsx",
]);

const ARCHIVE_BINARY_EXTENSIONS = new Set([
  "7z",
  "apk",
  "bin",
  "bz2",
  "dmg",
  "exe",
  "gz",
  "iso",
  "jar",
  "rar",
  "tar",
  "tgz",
  "xz",
  "zip",
]);

const HUMAN_MIME_LABELS: Record<string, string> = {
  "application/gzip": "GZIP",
  "application/java-archive": "JAR",
  "application/json": "JSON",
  "application/msword": "DOC",
  "application/octet-stream": "binary",
  "application/pdf": "PDF",
  "application/rtf": "RTF",
  "application/vnd.android.package-archive": "APK",
  "application/vnd.ms-excel": "XLS",
  "application/vnd.ms-powerpoint": "PPT",
  "application/vnd.oasis.opendocument.presentation": "ODP",
  "application/vnd.oasis.opendocument.spreadsheet": "ODS",
  "application/vnd.oasis.opendocument.text": "ODT",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/x-7z-compressed": "7Z",
  "application/x-apple-diskimage": "DMG",
  "application/x-bzip2": "BZ2",
  "application/x-executable": "EXE",
  "application/x-rar-compressed": "RAR",
  "application/x-tar": "TAR",
  "application/zip": "ZIP",
  "text/csv": "CSV",
  "text/markdown": "Markdown",
  "text/plain": "TXT",
};

export function formatAttachmentSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0 Б";
  }

  const units = ["Б", "КБ", "МБ", "ГБ"];
  let value = sizeBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function describeAttachmentMimeType(mimeType: string): string {
  const normalized = normalizeMimeType(mimeType);
  if (normalized === "") {
    return "неизвестный MIME";
  }

  const knownLabel = HUMAN_MIME_LABELS[normalized];
  if (knownLabel) {
    return knownLabel;
  }

  for (const prefix of ["image/", "video/", "audio/"]) {
    if (normalized.startsWith(prefix)) {
      const subtype = normalized.slice(prefix.length).trim();
      if (subtype !== "") {
        return subtype.toUpperCase();
      }
    }
  }

  return normalized;
}

export function canRenderInlineImagePreview(mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType);
  return normalized.startsWith("image/") && normalized !== "image/svg+xml";
}

export function classifyAttachmentForDisplay(input: {
  fileName: string;
  mimeType: string;
}): AttachmentDisplayCategory {
  const normalizedMime = normalizeMimeType(input.mimeType);

  if (normalizedMime.startsWith("image/")) {
    return "image";
  }

  if (normalizedMime.startsWith("audio/")) {
    return "audio";
  }

  if (normalizedMime.startsWith("video/")) {
    return "video";
  }

  if (normalizedMime.startsWith("text/") || DOCUMENT_MIME_TYPES.has(normalizedMime)) {
    return "document";
  }

  if (
    normalizedMime !== "" &&
    normalizedMime !== "application/octet-stream" &&
    ARCHIVE_BINARY_MIME_TYPES.has(normalizedMime)
  ) {
    return "archive-binary";
  }

  const extension = normalizeFileExtension(input.fileName);
  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return "audio";
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }
  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return "document";
  }
  if (ARCHIVE_BINARY_EXTENSIONS.has(extension)) {
    return "archive-binary";
  }

  if (normalizedMime === "application/octet-stream") {
    return "archive-binary";
  }

  return "generic-file";
}

export function getAttachmentDisplayDescriptor(input: {
  fileName: string;
  mimeType: string;
}): AttachmentDisplayDescriptor {
  const category = classifyAttachmentForDisplay(input);
  const mimeLabel = describeAttachmentMimeType(input.mimeType);

  switch (category) {
    case "image":
      return {
        category,
        badgeLabel: "IMG",
        categoryLabel: "Изображение",
        mimeLabel,
      };
    case "audio":
      return {
        category,
        badgeLabel: "AUD",
        categoryLabel: "Аудио",
        mimeLabel,
      };
    case "video":
      return {
        category,
        badgeLabel: "VID",
        categoryLabel: "Видео",
        mimeLabel,
      };
    case "document":
      return {
        category,
        badgeLabel: "DOC",
        categoryLabel: "Документ",
        mimeLabel,
      };
    case "archive-binary":
      return {
        category,
        badgeLabel: "BIN",
        categoryLabel: "Архив / binary",
        mimeLabel,
      };
    default:
      return {
        category,
        badgeLabel: "FILE",
        categoryLabel: "Файл",
        mimeLabel,
      };
  }
}

function normalizeMimeType(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeFileExtension(fileName: string): string {
  const normalizedName = fileName.trim().toLowerCase();
  const extensionSeparatorIndex = normalizedName.lastIndexOf(".");
  if (extensionSeparatorIndex <= 0 || extensionSeparatorIndex === normalizedName.length - 1) {
    return "";
  }

  return normalizedName.slice(extensionSeparatorIndex + 1);
}
