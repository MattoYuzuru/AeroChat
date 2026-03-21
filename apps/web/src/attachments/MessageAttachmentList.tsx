import { useEffect, useRef, useState } from "react";
import type { Attachment } from "../gateway/types";
import {
  type AttachmentInlinePreviewKind,
  formatAttachmentSize,
  getAttachmentInlinePreviewKind,
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
        const inlinePreviewKind = getAttachmentInlinePreviewKind(attachment.mimeType);

        return (
          <article
            className={styles.card}
            data-category={descriptor.category}
            data-tone={tone}
            key={attachment.id}
          >
            {inlinePreviewKind !== null && (
              <InlineAttachmentPreview
                accessToken={accessToken}
                attachment={attachment}
                isPending={isPending}
                onOpenAttachment={onOpenAttachment}
                previewKind={inlinePreviewKind}
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

function InlineAttachmentPreview({
  accessToken,
  attachment,
  isPending,
  onOpenAttachment,
  previewKind,
}: {
  accessToken: string;
  attachment: Attachment;
  isPending: boolean;
  onOpenAttachment(attachmentId: string): void;
  previewKind: AttachmentInlinePreviewKind;
}) {
  const triggerRef = useRef<HTMLDivElement | null>(null);
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
      <div className={styles.previewViewport} ref={triggerRef}>
        {status === "ready" && previewUrl !== null ? (
          <ReadyInlineAttachmentPreview
            attachment={attachment}
            isPending={isPending}
            onMediaError={handleImageError}
            onOpenAttachment={onOpenAttachment}
            previewKind={previewKind}
            previewUrl={previewUrl}
          />
        ) : previewKind === "image" ? (
          <button
            aria-label={`Открыть изображение ${attachment.fileName}`}
            className={styles.previewButton}
            data-kind={previewKind}
            data-state={status}
            disabled={isPending}
            onClick={() => {
              onOpenAttachment(attachment.id);
            }}
            type="button"
          >
            <div className={styles.previewPlaceholder} data-kind={previewKind}>
              <span className={styles.previewPlaceholderLabel}>
                {getPreviewPlaceholderLabel(previewKind)}
              </span>
              <span className={styles.previewPlaceholderText}>
                {getPreviewPlaceholderText(previewKind, status)}
              </span>
            </div>
          </button>
        ) : (
          <div className={styles.previewPlaceholder} data-kind={previewKind}>
            <span className={styles.previewPlaceholderLabel}>
              {getPreviewPlaceholderLabel(previewKind)}
            </span>
            <span className={styles.previewPlaceholderText}>
              {getPreviewPlaceholderText(previewKind, status)}
            </span>
          </div>
        )}
      </div>

      {status === "error" && (
        <p className={styles.previewCaption}>
          {getPreviewErrorCaption(previewKind)}
        </p>
      )}
    </div>
  );
}

function ReadyInlineAttachmentPreview({
  attachment,
  isPending,
  onMediaError,
  onOpenAttachment,
  previewKind,
  previewUrl,
}: {
  attachment: Attachment;
  isPending: boolean;
  onMediaError(): void;
  onOpenAttachment(attachmentId: string): void;
  previewKind: AttachmentInlinePreviewKind;
  previewUrl: string;
}) {
  if (previewKind === "image") {
    return (
      <button
        aria-label={`Открыть изображение ${attachment.fileName}`}
        className={styles.previewButton}
        data-kind={previewKind}
        data-state="ready"
        disabled={isPending}
        onClick={() => {
          onOpenAttachment(attachment.id);
        }}
        type="button"
      >
        <img
          alt=""
          className={styles.previewImage}
          loading="lazy"
          onError={onMediaError}
          src={previewUrl}
        />
        <span className={styles.previewOverlay}>Открыть оригинал</span>
      </button>
    );
  }

  if (previewKind === "audio") {
    return (
      <div className={styles.mediaSurface} data-kind={previewKind} data-state="ready">
        <audio
          aria-label={`Аудиовложение ${attachment.fileName}`}
          className={styles.audioPlayer}
          controls
          onError={onMediaError}
          preload="metadata"
          src={previewUrl}
        />
      </div>
    );
  }

  return (
    <div className={styles.mediaSurface} data-kind={previewKind} data-state="ready">
      <video
        aria-label={`Видеовложение ${attachment.fileName}`}
        className={styles.videoPlayer}
        controls
        onError={onMediaError}
        playsInline
        preload="metadata"
        src={previewUrl}
      />
    </div>
  );
}

function getPreviewPlaceholderLabel(previewKind: AttachmentInlinePreviewKind): string {
  switch (previewKind) {
    case "audio":
      return "Inline audio";
    case "video":
      return "Inline video";
    default:
      return "Inline preview";
  }
}

function getPreviewPlaceholderText(
  previewKind: AttachmentInlinePreviewKind,
  status: PreviewStatus,
): string {
  if (status === "loading") {
    switch (previewKind) {
      case "audio":
        return "Готовим inline-аудиоплеер...";
      case "video":
        return "Готовим inline-видеоплеер...";
      default:
        return "Загружаем изображение...";
    }
  }

  if (status === "error") {
    switch (previewKind) {
      case "audio":
        return "Inline-аудио недоступно.";
      case "video":
        return "Inline-видео недоступно.";
      default:
        return "Preview недоступен.";
    }
  }

  switch (previewKind) {
    case "audio":
      return "Плеер загрузится, когда карточка появится в ленте.";
    case "video":
      return "Видеоплеер загрузится, когда карточка появится в ленте.";
    default:
      return "Preview загрузится, когда карточка появится в ленте.";
  }
}

function getPreviewErrorCaption(previewKind: AttachmentInlinePreviewKind): string {
  switch (previewKind) {
    case "audio":
      return "Inline-аудио недоступно. Используйте кнопки «Открыть» или «Скачать».";
    case "video":
      return "Inline-видео недоступно. Используйте кнопки «Открыть» или «Скачать».";
    default:
      return "Переходим к обычной file-card модели: используйте кнопки «Открыть» или «Скачать».";
  }
}
