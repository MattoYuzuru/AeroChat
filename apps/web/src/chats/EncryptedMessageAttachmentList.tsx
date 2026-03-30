import { useEffect, useRef, useState } from "react";
import { useCryptoRuntime } from "../crypto/useCryptoRuntime";
import type { EncryptedMediaAttachmentDescriptor } from "../crypto/types";
import { gatewayClient } from "../gateway/runtime";
import { openUrlInNewTab } from "../attachments/open";
import {
  formatAttachmentSize,
  getAttachmentDisplayDescriptor,
  getAttachmentInlinePreviewKind,
  type AttachmentInlinePreviewKind,
} from "../attachments/metadata";
import styles from "../attachments/MessageAttachmentList.module.css";

interface EncryptedMessageAttachmentListProps {
  accessToken: string;
  attachments: EncryptedMediaAttachmentDescriptor[];
  tone?: "own" | "other";
}

export function EncryptedMessageAttachmentList({
  accessToken,
  attachments,
  tone = "other",
}: EncryptedMessageAttachmentListProps) {
  const cryptoRuntime = useCryptoRuntime();

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className={styles.list}>
      {attachments.map((attachment) => {
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
            key={attachment.attachmentId}
          >
            {inlinePreviewKind !== null && (
              <EncryptedInlineAttachmentPreview
                accessToken={accessToken}
                attachment={attachment}
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
                <p className={styles.meta}>
                  {formatAttachmentSize(attachment.plaintextSizeBytes)}
                </p>
              </div>
            </div>

            <div className={styles.actions}>
              <button
                className={styles.action}
                onClick={() => {
                  void openEncryptedAttachment(cryptoRuntime, accessToken, attachment);
                }}
                type="button"
              >
                Открыть
              </button>
              <button
                className={styles.action}
                data-variant="secondary"
                onClick={() => {
                  void downloadEncryptedAttachment(cryptoRuntime, accessToken, attachment);
                }}
                type="button"
              >
                Скачать
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

type PreviewStatus = "idle" | "loading" | "ready" | "error";

function EncryptedInlineAttachmentPreview({
  accessToken,
  attachment,
  previewKind,
}: {
  accessToken: string;
  attachment: EncryptedMediaAttachmentDescriptor;
  previewKind: AttachmentInlinePreviewKind;
}) {
  const cryptoRuntime = useCryptoRuntime();
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const revokePreviewRef = useRef<(() => void) | null>(null);
  const startsVisible = typeof IntersectionObserver === "undefined";
  const [isVisible, setIsVisible] = useState(startsVisible);
  const [status, setStatus] = useState<PreviewStatus>(startsVisible ? "loading" : "idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      revokePreviewRef.current?.();
      revokePreviewRef.current = null;
    };
  }, []);

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
    if (!isVisible || accessToken.trim() === "" || status !== "loading") {
      return;
    }

    let active = true;

    void resolveEncryptedAttachmentObjectUrl(cryptoRuntime, accessToken, attachment)
      .then((resolved) => {
        if (!active) {
          resolved.revoke();
          return;
        }

        revokePreviewRef.current?.();
        revokePreviewRef.current = resolved.revoke;
        setPreviewUrl(resolved.url);
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
  }, [accessToken, attachment, cryptoRuntime, isVisible, status]);

  function handleMediaError() {
    revokePreviewRef.current?.();
    revokePreviewRef.current = null;
    setPreviewUrl(null);
    setStatus("error");
  }

  return (
    <div className={styles.previewSection}>
      <div className={styles.previewViewport} ref={triggerRef}>
        {status === "ready" && previewUrl !== null ? (
          <ReadyEncryptedInlinePreview
            attachment={attachment}
            cryptoRuntime={cryptoRuntime}
            onMediaError={handleMediaError}
            previewKind={previewKind}
            previewUrl={previewUrl}
          />
        ) : (
          <div className={styles.previewPlaceholder} data-kind={previewKind}>
            <span className={styles.previewPlaceholderLabel}>
              {previewKind === "audio"
                ? "Аудио"
                : previewKind === "video"
                  ? "Видео"
                  : "Предпросмотр"}
            </span>
            <span className={styles.previewPlaceholderText}>
              {status === "loading"
                ? previewKind === "audio"
                  ? "Готовим аудио..."
                  : previewKind === "video"
                    ? "Готовим видео..."
                    : "Готовим изображение..."
                : status === "error"
                  ? "Предпросмотр недоступен."
                  : "Предпросмотр появится при прокрутке."}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ReadyEncryptedInlinePreview({
  attachment,
  cryptoRuntime,
  onMediaError,
  previewKind,
  previewUrl,
}: {
  attachment: EncryptedMediaAttachmentDescriptor;
  cryptoRuntime: ReturnType<typeof useCryptoRuntime>;
  onMediaError(): void;
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
        onClick={() => {
          void openEncryptedAttachment(cryptoRuntime, "", attachment, previewUrl);
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

async function openEncryptedAttachment(
  cryptoRuntime: ReturnType<typeof useCryptoRuntime>,
  accessToken: string,
  attachment: EncryptedMediaAttachmentDescriptor,
  existingUrl?: string,
) {
  const resolved =
    existingUrl === undefined
      ? await resolveEncryptedAttachmentObjectUrl(cryptoRuntime, accessToken, attachment)
      : { url: existingUrl, revoke() {} };
  openUrlInNewTab(resolved.url);
  if (existingUrl === undefined) {
    window.setTimeout(() => {
      resolved.revoke();
    }, 60_000);
  }
}

async function downloadEncryptedAttachment(
  cryptoRuntime: ReturnType<typeof useCryptoRuntime>,
  accessToken: string,
  attachment: EncryptedMediaAttachmentDescriptor,
) {
  const resolved = await resolveEncryptedAttachmentObjectUrl(
    cryptoRuntime,
    accessToken,
    attachment,
  );
  const anchor = document.createElement("a");

  anchor.href = resolved.url;
  anchor.rel = "noopener noreferrer";
  anchor.download = attachment.fileName.trim() === "" ? "attachment" : attachment.fileName;
  anchor.style.display = "none";

  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    resolved.revoke();
  }, 5_000);
}

async function resolveEncryptedAttachmentObjectUrl(
  cryptoRuntime: ReturnType<typeof useCryptoRuntime>,
  accessToken: string,
  attachment: EncryptedMediaAttachmentDescriptor,
): Promise<{
  url: string;
  revoke(): void;
}> {
  const access = await gatewayClient.getAttachment(accessToken, attachment.attachmentId);
  if (!access.downloadUrl) {
    throw new Error("Файл пока недоступен для скачивания.");
  }

  const response = await fetch(access.downloadUrl);
  if (!response.ok) {
    throw new Error("Не удалось скачать файл.");
  }

  const decrypted = await cryptoRuntime.decryptEncryptedMediaAttachment({
    attachmentId: attachment.attachmentId,
    ciphertextBytes: await response.arrayBuffer(),
  });
  if (decrypted === null) {
    throw new Error("Не удалось подготовить файл к открытию.");
  }

  const objectUrl = URL.createObjectURL(
    new Blob([decrypted.plaintextBytes], {
      type: decrypted.mimeType,
    }),
  );
  return {
    url: objectUrl,
    revoke() {
      URL.revokeObjectURL(objectUrl);
    },
  };
}
