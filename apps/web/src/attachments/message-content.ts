interface MessageComposerAvailabilityInput {
  text: string;
  uploadedAttachmentId: string | null;
  isUploading: boolean;
  canSendMessages?: boolean;
}

export function normalizeComposerMessageText(value: string): string {
  return value.trim();
}

export function hasMeaningfulMessageText(value: string): boolean {
  return normalizeComposerMessageText(value) !== "";
}

export function hasUploadedAttachment(uploadedAttachmentId: string | null): boolean {
  return uploadedAttachmentId !== null && uploadedAttachmentId.trim() !== "";
}

export function canSubmitMessageComposer(
  input: MessageComposerAvailabilityInput,
): boolean {
  if (input.canSendMessages === false) {
    return false;
  }

  return (
    hasMeaningfulMessageText(input.text) ||
    hasUploadedAttachment(input.uploadedAttachmentId)
  );
}

export function hasRenderableMessageText(
  content: { text: string } | null | undefined,
): boolean {
  return content !== null && content !== undefined && content.text.trim() !== "";
}
