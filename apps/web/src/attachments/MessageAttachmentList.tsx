import { useEffect, useRef, useState } from "react";
import type { Attachment } from "../gateway/types";
import {
  canRenderInlineImagePreview,
  formatAttachmentSize,
  getAttachmentDisplayDescriptor,
} from "./metadata";
import { resolveAttachmentDownloadUrl } from "./open";
import styles from "./MessageAttachmentList.module.css";

interface MessageAttachmentListProps {
  accessToken: string;
  attachments: Attachment[];
  pendingAttachmentId: string | null;
  onOpenAttachment(attachmentId: string): void;
  onDownloadAttachment(attachment: Attachment): void;
  tone?: "own" | "other";
}

export function MessageAttachmentList({
  accessToken,
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
            {canRenderInlineImagePreview(attachment.mimeType) && (
              <InlineImageAttachmentPreview
                accessToken={accessToken}
                attachment={attachment}
                isPending={isPending}
                onOpenAttachment={onOpenAttachment}
              />
            )}

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

type PreviewStatus = "idle" | "loading" | "ready" | "error";

function InlineImageAttachmentPreview({
  accessToken,
  attachment,
  isPending,
  onOpenAttachment,
}: {
  accessToken: string;
  attachment: Attachment;
  isPending: boolean;
  onOpenAttachment(attachmentId: string): void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const startsVisible = typeof IntersectionObserver === "undefined";
  const [isVisible, setIsVisible] = useState(startsVisible);
  const [status, setStatus] = useState<PreviewStatus>(startsVisible ? "loading" : "idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const node = triggerRef.current;
    if (node === null || isVisible) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }

        setIsVisible(true);
        setStatus((currentStatus) => (currentStatus === "idle" ? "loading" : currentStatus));
        observer.disconnect();
      },
      {
        rootMargin: "180px 0px",
      },
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible || accessToken.trim() === "") {
      return;
    }

    if (status !== "loading") {
      return;
    }

    let active = true;

    void resolveAttachmentDownloadUrl(accessToken, attachment.id)
      .then((downloadUrl) => {
        if (!active) {
          return;
        }

        setPreviewUrl(downloadUrl);
        setStatus("ready");
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setPreviewUrl(null);
        setStatus("error");
      });

    return () => {
      active = false;
    };
  }, [accessToken, attachment.id, isVisible, status]);

  function handleImageError() {
    setPreviewUrl(null);
    setStatus("error");
  }

  return (
    <div className={styles.previewSection}>
      <button
        aria-label={`Открыть изображение ${attachment.fileName}`}
        className={styles.previewButton}
        data-state={status}
        disabled={isPending}
        onClick={() => {
          onOpenAttachment(attachment.id);
        }}
        ref={triggerRef}
        type="button"
      >
        {status === "ready" && previewUrl !== null ? (
          <>
            <img
              alt=""
              className={styles.previewImage}
              loading="lazy"
              onError={handleImageError}
              src={previewUrl}
            />
            <span className={styles.previewOverlay}>Открыть оригинал</span>
          </>
        ) : (
          <span className={styles.previewPlaceholder}>
            <span className={styles.previewPlaceholderLabel}>Inline preview</span>
            <span className={styles.previewPlaceholderText}>
              {status === "loading"
                ? "Загружаем изображение..."
                : status === "error"
                  ? "Preview недоступен."
                  : "Preview загрузится, когда карточка появится в ленте."}
            </span>
          </span>
        )}
      </button>

      {status === "error" && (
        <p className={styles.previewCaption}>
          Переходим к обычной file-card модели: используйте кнопки «Открыть» или «Скачать».
        </p>
      )}
    </div>
  );
}
