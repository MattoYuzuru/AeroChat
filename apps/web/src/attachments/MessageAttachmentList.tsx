import type { Attachment } from "../gateway/types";
import { describeAttachmentMimeType, formatAttachmentSize } from "./metadata";
import styles from "./MessageAttachmentList.module.css";

interface MessageAttachmentListProps {
  attachments: Attachment[];
  pendingAttachmentId: string | null;
  onOpenAttachment(attachmentId: string): void;
}

export function MessageAttachmentList({
  attachments,
  pendingAttachmentId,
  onOpenAttachment,
}: MessageAttachmentListProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className={styles.list}>
      {attachments.map((attachment) => {
        const isPending = pendingAttachmentId === attachment.id;

        return (
          <article className={styles.card} key={attachment.id}>
            <p className={styles.title}>{attachment.fileName}</p>
            <p className={styles.meta}>
              {formatAttachmentSize(attachment.sizeBytes)} •{" "}
              {describeAttachmentMimeType(attachment.mimeType)}
            </p>
            <button
              className={styles.action}
              disabled={isPending}
              onClick={() => {
                onOpenAttachment(attachment.id);
              }}
              type="button"
            >
              {isPending ? "Готовим ссылку..." : "Открыть файл"}
            </button>
          </article>
        );
      })}
    </div>
  );
}
