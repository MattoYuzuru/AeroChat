import { gatewayClient } from "../gateway/runtime";

export async function openAttachmentInNewTab(
  token: string,
  attachmentId: string,
): Promise<void> {
  const access = await gatewayClient.getAttachment(token, attachmentId);
  if (!access.downloadUrl) {
    throw new Error("Файл пока недоступен для скачивания.");
  }

  const openedWindow = window.open(access.downloadUrl, "_blank", "noopener,noreferrer");
  if (openedWindow !== null) {
    return;
  }

  window.location.assign(access.downloadUrl);
}
