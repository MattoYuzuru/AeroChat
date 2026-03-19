export function formatAttachmentSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0 Б";
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} Б`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} КБ`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export function describeAttachmentMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === "") {
    return "неизвестный тип";
  }

  if (normalized === "application/pdf") {
    return "PDF";
  }

  if (normalized.startsWith("image/")) {
    return `image/${normalized.slice("image/".length)}`;
  }

  if (normalized.startsWith("video/")) {
    return `video/${normalized.slice("video/".length)}`;
  }

  if (normalized.startsWith("audio/")) {
    return `audio/${normalized.slice("audio/".length)}`;
  }

  return normalized;
}
