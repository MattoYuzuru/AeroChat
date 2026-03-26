export type ChatGlyphKind =
  | "attach"
  | "microphone"
  | "microphone_active"
  | "camera"
  | "camera_active"
  | "send"
  | "phone"
  | "pin"
  | "unpin"
  | "reply"
  | "edit"
  | "delete"
  | "chevron_left"
  | "chevron_right";

export function ChatGlyph({
  className,
  kind,
  title,
}: {
  className?: string;
  kind: ChatGlyphKind;
  title?: string;
}) {
  return (
    <svg
      aria-hidden={title ? undefined : "true"}
      className={className}
      role={title ? "img" : "presentation"}
      viewBox="0 0 16 16"
    >
      {title ? <title>{title}</title> : null}
      {renderChatGlyph(kind)}
    </svg>
  );
}

function renderChatGlyph(kind: ChatGlyphKind) {
  switch (kind) {
    case "attach":
      return (
        <path
          d="M6 4.5v6a2.5 2.5 0 0 0 5 0V4.8a1.7 1.7 0 0 0-3.4 0V10a.9.9 0 0 0 1.8 0V6.2"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.4"
        />
      );
    case "microphone":
    case "microphone_active":
      return (
        <>
          <rect
            x="5.3"
            y="2.2"
            width="5.4"
            height="7.5"
            rx="2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <path
            d="M3.8 7.8a4.2 4.2 0 0 0 8.4 0M8 12v2.1M5.9 14.1h4.2"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.3"
          />
          {kind === "microphone_active" ? (
            <circle cx="12.7" cy="3.5" r="1.5" fill="currentColor" />
          ) : null}
        </>
      );
    case "camera":
    case "camera_active":
      return (
        <>
          <rect
            x="2.3"
            y="4.2"
            width="8.7"
            height="7.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <path
            d="M11 6.1 13.8 4.8v6.1L11 9.6"
            fill="none"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.3"
          />
          {kind === "camera_active" ? (
            <circle cx="3.6" cy="3.4" r="1.3" fill="currentColor" />
          ) : null}
        </>
      );
    case "send":
      return (
        <path
          d="M2.2 8 13.8 2.5 10.3 13.5 7.4 9.2zM7.4 9.2 13.8 2.5"
          fill="none"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.3"
        />
      );
    case "phone":
      return (
        <>
          <path
            d="M4 2.7h2.2l1.1 2.6-1.2 1.3c.7 1.3 1.8 2.4 3.1 3.1l1.3-1.2 2.6 1.1v2.2c0 .5-.4.9-.9.9A9.4 9.4 0 0 1 3.1 3.6c0-.5.4-.9.9-.9Z"
            fill="none"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.2"
          />
          <path
            d="M10.4 3.5a3 3 0 0 1 2.1 2.1M10.4 1.8a4.8 4.8 0 0 1 3.8 3.8"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.1"
          />
        </>
      );
    case "pin":
    case "unpin":
      return (
        <>
          <path
            d="M5.2 2.5h5.6l-.8 2.8 1.8 1.7H4.2L6 5.3z"
            fill="none"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.2"
          />
          <path
            d="M8 8v5.2"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.2"
          />
          {kind === "unpin" ? (
            <path
              d="M3 13 13 3"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.2"
            />
          ) : null}
        </>
      );
    case "reply":
      return (
        <path
          d="M6.3 4 2.8 7.2l3.5 3.1V8.4h2.2c2.4 0 4 1 4.7 3.1-.1-3.2-1.9-5.5-5.2-5.5H6.3z"
          fill="none"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.2"
        />
      );
    case "edit":
      return (
        <>
          <path
            d="M3.1 10.9 10.4 3.6l2 2-7.3 7.3-2.6.6z"
            fill="none"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.2"
          />
          <path
            d="M9.3 4.7 11.3 6.7"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.2"
          />
        </>
      );
    case "delete":
      return (
        <>
          <path
            d="M4.6 4.3h6.8l-.5 8H5.1z"
            fill="none"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.2"
          />
          <path
            d="M3.6 4.3h8.8M6.2 4.3V2.8h3.6v1.5M6.5 6.3v4M9.5 6.3v4"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.2"
          />
        </>
      );
    case "chevron_left":
      return (
        <path
          d="M9.8 3.2 5.2 8l4.6 4.8"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      );
    case "chevron_right":
      return (
        <path
          d="M6.2 3.2 10.8 8l-4.6 4.8"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      );
  }
}
