import type { ReactNode } from "react";
import styles from "./SafeMessageMarkdown.module.css";

interface SafeMessageMarkdownProps {
  text: string;
}

type MarkdownBlock =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; items: string[] };

export function SafeMessageMarkdown({ text }: SafeMessageMarkdownProps) {
  const blocks = parseSafeMessageMarkdown(text);

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className={styles.root}>
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}

function renderBlock(block: MarkdownBlock, index: number) {
  if (block.kind === "list") {
    return (
      <ul key={`list-${index}`} className={styles.list}>
        {block.items.map((item, itemIndex) => (
          <li key={`item-${itemIndex}`} className={styles.listItem}>
            {renderInline(item, `${index}-${itemIndex}`)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <p key={`paragraph-${index}`} className={styles.paragraph}>
      {block.lines.map((line, lineIndex) => (
        <span key={`line-${lineIndex}`}>
          {lineIndex > 0 && <br />}
          {renderInline(line, `${index}-${lineIndex}`)}
        </span>
      ))}
    </p>
  );
}

function parseSafeMessageMarkdown(text: string): MarkdownBlock[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (normalized === "") {
    return [];
  }

  return normalized
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== "")
    .map((chunk) => {
      const lines = chunk.split("\n");

      if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
        return {
          kind: "list" as const,
          items: lines.map((line) => line.replace(/^\s*[-*]\s+/, "").trim()),
        };
      }

      return {
        kind: "paragraph" as const,
        lines: lines.map((line) => line.trimEnd()),
      };
    });
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let partIndex = 0;

  while (cursor < text.length) {
    const codeNode = tryRenderCode(text, cursor, keyPrefix, partIndex);
    if (codeNode) {
      nodes.push(codeNode.node);
      cursor = codeNode.nextCursor;
      partIndex += 1;
      continue;
    }

    const strongNode = tryRenderDelimited(text, cursor, "**", "strong", keyPrefix, partIndex);
    if (strongNode) {
      nodes.push(strongNode.node);
      cursor = strongNode.nextCursor;
      partIndex += 1;
      continue;
    }

    const emphasisNode = tryRenderDelimited(text, cursor, "*", "em", keyPrefix, partIndex);
    if (emphasisNode) {
      nodes.push(emphasisNode.node);
      cursor = emphasisNode.nextCursor;
      partIndex += 1;
      continue;
    }

    const linkNode = tryRenderLink(text, cursor, keyPrefix, partIndex);
    if (linkNode) {
      nodes.push(linkNode.node);
      cursor = linkNode.nextCursor;
      partIndex += 1;
      continue;
    }

    const nextSpecialIndex = findNextSpecialIndex(text, cursor);
    if (nextSpecialIndex === cursor) {
      nodes.push(text[cursor]);
      cursor += 1;
      partIndex += 1;
      continue;
    }

    const nextCursor = nextSpecialIndex === -1 ? text.length : nextSpecialIndex;
    nodes.push(text.slice(cursor, nextCursor));
    cursor = nextCursor;
    partIndex += 1;
  }

  return nodes;
}

function tryRenderCode(
  text: string,
  cursor: number,
  keyPrefix: string,
  partIndex: number,
) {
  if (text[cursor] !== "`") {
    return null;
  }

  const endIndex = text.indexOf("`", cursor + 1);
  if (endIndex <= cursor + 1) {
    return null;
  }

  return {
    node: (
      <code key={`${keyPrefix}-code-${partIndex}`} className={styles.code}>
        {text.slice(cursor + 1, endIndex)}
      </code>
    ),
    nextCursor: endIndex + 1,
  };
}

function tryRenderDelimited(
  text: string,
  cursor: number,
  delimiter: "*" | "**",
  tag: "em" | "strong",
  keyPrefix: string,
  partIndex: number,
) {
  if (!text.startsWith(delimiter, cursor)) {
    return null;
  }

  const endIndex = text.indexOf(delimiter, cursor + delimiter.length);
  if (endIndex <= cursor + delimiter.length) {
    return null;
  }

  const content = text.slice(cursor + delimiter.length, endIndex);
  if (content.trim() === "") {
    return null;
  }

  const children = renderInline(content, `${keyPrefix}-${tag}-${partIndex}`);
  const className = tag === "strong" ? styles.strong : styles.emphasis;

  return {
    node:
      tag === "strong" ? (
        <strong key={`${keyPrefix}-${tag}-${partIndex}`} className={className}>
          {children}
        </strong>
      ) : (
        <em key={`${keyPrefix}-${tag}-${partIndex}`} className={className}>
          {children}
        </em>
      ),
    nextCursor: endIndex + delimiter.length,
  };
}

function tryRenderLink(
  text: string,
  cursor: number,
  keyPrefix: string,
  partIndex: number,
) {
  if (text[cursor] !== "[") {
    return null;
  }

  const separatorIndex = text.indexOf("](", cursor + 1);
  if (separatorIndex === -1) {
    return null;
  }

  const endIndex = text.indexOf(")", separatorIndex + 2);
  if (endIndex === -1) {
    return null;
  }

  const label = text.slice(cursor + 1, separatorIndex);
  const href = normalizeSafeHref(text.slice(separatorIndex + 2, endIndex));
  if (!href || label.trim() === "") {
    return null;
  }

  return {
    node: (
      <a
        key={`${keyPrefix}-link-${partIndex}`}
        className={styles.link}
        href={href}
        rel="noreferrer noopener"
        target="_blank"
      >
        {renderInline(label, `${keyPrefix}-label-${partIndex}`)}
      </a>
    ),
    nextCursor: endIndex + 1,
  };
}

function findNextSpecialIndex(text: string, cursor: number): number {
  const candidates = [
    text.indexOf("`", cursor),
    text.indexOf("*", cursor),
    text.indexOf("[", cursor),
  ].filter((value) => value !== -1);

  if (candidates.length === 0) {
    return -1;
  }

  return Math.min(...candidates);
}

function normalizeSafeHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}
