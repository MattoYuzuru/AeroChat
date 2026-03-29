import { describe, expect, it } from "vitest";
import {
  buildWebAppInstallGuide,
  detectWebAppInstallPlatform,
  isInstalledWebApp,
} from "./install";

describe("detectWebAppInstallPlatform", () => {
  it("detects iOS devices including iPadOS desktop user agents", () => {
    expect(
      detectWebAppInstallPlatform({
        isDesktopViewport: false,
        maxTouchPoints: 5,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      }),
    ).toBe("ios");
    expect(
      detectWebAppInstallPlatform({
        isDesktopViewport: false,
        maxTouchPoints: 5,
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      }),
    ).toBe("ios");
  });

  it("distinguishes desktop Safari and Chromium flows", () => {
    expect(
      detectWebAppInstallPlatform({
        isDesktopViewport: true,
        maxTouchPoints: 0,
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      }),
    ).toBe("desktop-safari");
    expect(
      detectWebAppInstallPlatform({
        isDesktopViewport: true,
        maxTouchPoints: 0,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      }),
    ).toBe("desktop-chromium");
  });
});

describe("isInstalledWebApp", () => {
  it("treats standalone display modes as installed context", () => {
    expect(
      isInstalledWebApp({
        displayModes: ["standalone"],
        navigatorStandalone: false,
      }),
    ).toBe(true);
    expect(
      isInstalledWebApp({
        displayModes: ["browser"],
        navigatorStandalone: true,
      }),
    ).toBe(true);
  });

  it("keeps regular browser tabs outside installed context", () => {
    expect(
      isInstalledWebApp({
        displayModes: ["browser"],
        navigatorStandalone: false,
      }),
    ).toBe(false);
  });
});

describe("buildWebAppInstallGuide", () => {
  it("prefers direct browser prompt when available", () => {
    const guide = buildWebAppInstallGuide({
      canPrompt: true,
      isInstalled: false,
      isDesktopViewport: true,
      maxTouchPoints: 0,
      promptOutcome: null,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    });

    expect(guide.tone).toBe("ready");
    expect(guide.actionLabel).toBe("Установить AeroChat");
    expect(guide.steps).toHaveLength(3);
  });

  it("returns iOS manual steps when prompt API is unavailable", () => {
    const guide = buildWebAppInstallGuide({
      canPrompt: false,
      isInstalled: false,
      isDesktopViewport: false,
      maxTouchPoints: 5,
      promptOutcome: null,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    });

    expect(guide.title).toContain("экран Домой");
    expect(guide.steps[1]).toContain("Поделиться");
    expect(guide.tone).toBe("manual");
  });

  it("marks already installed surfaces explicitly", () => {
    const guide = buildWebAppInstallGuide({
      canPrompt: false,
      isInstalled: true,
      isDesktopViewport: false,
      maxTouchPoints: 5,
      promptOutcome: null,
      userAgent: "",
    });

    expect(guide.tone).toBe("installed");
    expect(guide.actionLabel).toBeNull();
  });
});
