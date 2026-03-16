import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createMarkdownPreview } from "./createMarkdownPreview";
import { SafeMessageMarkdown } from "./SafeMessageMarkdown";

describe("SafeMessageMarkdown", () => {
  it("renders a lightweight safe markdown subset without raw html", () => {
    const markup = renderToStaticMarkup(
      <SafeMessageMarkdown
        text={"Привет, **мир**.\n- `код`\n\nСсылка: [AeroChat](https://example.com)"}
      />,
    );

    expect(markup).toContain("<strong");
    expect(markup).toContain("<code");
    expect(markup).toContain("<a");
    expect(markup).toContain("https://example.com/");
  });

  it("does not render unsafe protocols as links", () => {
    const markup = renderToStaticMarkup(
      <SafeMessageMarkdown text={"[unsafe](javascript:alert(1)) и <script>alert(1)</script>"} />,
    );

    expect(markup).not.toContain("<a");
    expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("createMarkdownPreview", () => {
  it("strips lightweight markdown syntax for compact previews", () => {
    expect(
      createMarkdownPreview("**Привет**, [AeroChat](https://example.com) и `код`"),
    ).toBe("Привет, AeroChat и код");
  });
});
