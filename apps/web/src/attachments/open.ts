import { gatewayClient } from "../gateway/runtime";

export async function resolveAttachmentDownloadUrl(
  token: string,
  attachmentId: string,
): Promise<string> {
  const access = await gatewayClient.getAttachment(token, attachmentId);
  if (!access.downloadUrl) {
    throw new Error("Файл пока недоступен для скачивания.");
  }

  return access.downloadUrl;
}

export async function openAttachmentInNewTab(
  token: string,
  attachmentId: string,
): Promise<void> {
  const downloadUrl = await resolveAttachmentDownloadUrl(token, attachmentId);

  const openedWindow = window.open(downloadUrl, "_blank", "noopener,noreferrer");
  if (openedWindow !== null) {
    return;
  }

  window.location.assign(downloadUrl);
}

export async function downloadAttachment(
  token: string,
  attachmentId: string,
  fileName: string,
): Promise<void> {
  const downloadUrl = await resolveAttachmentDownloadUrl(token, attachmentId);
  const anchor = document.createElement("a");

  anchor.href = downloadUrl;
  anchor.rel = "noopener noreferrer";
  anchor.download = fileName.trim() === "" ? "attachment" : fileName;
  anchor.style.display = "none";

  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
