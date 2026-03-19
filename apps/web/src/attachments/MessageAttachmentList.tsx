import type { Attachment } from "../gateway/types";
import { formatAttachmentSize, getAttachmentDisplayDescriptor } from "./metadata";
import styles from "./MessageAttachmentList.module.css";

interface MessageAttachmentListProps {
  attachments: Attachment[];
  pendingAttachmentId: string | null;
  onOpenAttachment(attachmentId: string): void;
  onDownloadAttachment(attachment: Attachment): void;
  tone?: "own" | "other";
}

export function MessageAttachmentList({
  attachments,
  pendingAttachmentId,
  onOpenAttachment,
  onDownloadAttachment,
  tone = "other",
}: MessageAttachmentListProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className={styles.list}>
      {attachments.map((attachment) => {
        const isPending = pendingAttachmentId === attachment.id;
        const descriptor = getAttachmentDisplayDescriptor({
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
        });

        return (
          <article
            className={styles.card}
            data-category={descriptor.category}
            data-tone={tone}
            key={attachment.id}
          >
            <div className={styles.header}>
              <span className={styles.badge} aria-hidden="true">
                {descriptor.badgeLabel}
              </span>

              <div className={styles.summary}>
                <div className={styles.labels}>
                  <span className={styles.categoryLabel}>{descriptor.categoryLabel}</span>
                  <span className={styles.mimeLabel}>{descriptor.mimeLabel}</span>
                </div>

                <p className={styles.title} title={attachment.fileName}>
                  {attachment.fileName}
                </p>
                <p className={styles.meta}>{formatAttachmentSize(attachment.sizeBytes)}</p>
              </div>
            </div>

            <div className={styles.actions}>
              <button
                className={styles.action}
                disabled={isPending}
                onClick={() => {
                  onOpenAttachment(attachment.id);
                }}
                type="button"
              >
                Открыть
              </button>
              <button
                className={styles.action}
                data-variant="secondary"
                disabled={isPending}
                onClick={() => {
                  onDownloadAttachment(attachment);
                }}
                type="button"
              >
                Скачать
              </button>
            </div>

            {isPending && <p className={styles.pending}>Готовим ссылку...</p>}
          </article>
        );
      })}
    </div>
  );
}
