import { useEffect, useMemo, useState } from "react";
import { useDesktopShellViewport } from "../shell/viewport";

export type InstallPromptOutcome = "accepted" | "dismissed";
export type WebAppInstallPlatform =
  | "ios"
  | "android"
  | "desktop-safari"
  | "desktop-chromium"
  | "desktop-generic";
export type WebAppInstallTone = "ready" | "manual" | "installed";

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void> | void;
  userChoice: Promise<{
    outcome: InstallPromptOutcome;
    platform: string;
  }>;
}

export interface WebAppInstallGuide {
  badge: string;
  title: string;
  description: string;
  steps: string[];
  actionLabel: string | null;
  secondaryActionLabel: string | null;
  tone: WebAppInstallTone;
}

interface WebAppInstallGuideInput {
  canPrompt: boolean;
  isInstalled: boolean;
  isDesktopViewport: boolean;
  maxTouchPoints: number;
  promptOutcome: InstallPromptOutcome | null;
  userAgent: string;
}

const standaloneDisplayModes = [
  "standalone",
  "fullscreen",
  "minimal-ui",
  "window-controls-overlay",
] as const;

export function detectWebAppInstallPlatform({
  isDesktopViewport,
  maxTouchPoints,
  userAgent,
}: Pick<WebAppInstallGuideInput, "isDesktopViewport" | "maxTouchPoints" | "userAgent">) {
  const normalizedUserAgent = userAgent.toLowerCase();
  const isAppleTouchDevice =
    /iphone|ipad|ipod/.test(normalizedUserAgent) ||
    (normalizedUserAgent.includes("macintosh") && maxTouchPoints > 1);

  if (isAppleTouchDevice) {
    return "ios";
  }

  if (normalizedUserAgent.includes("android")) {
    return "android";
  }

  const isChromium =
    normalizedUserAgent.includes("chrome/") ||
    normalizedUserAgent.includes("crios/") ||
    normalizedUserAgent.includes("edg/") ||
    normalizedUserAgent.includes("chromium") ||
    normalizedUserAgent.includes("opr/");
  const isSafari =
    normalizedUserAgent.includes("safari/") &&
    !isChromium &&
    !normalizedUserAgent.includes("android");

  if (isDesktopViewport && isSafari) {
    return "desktop-safari";
  }

  if (isDesktopViewport && isChromium) {
    return "desktop-chromium";
  }

  return "desktop-generic";
}

export function isInstalledWebApp({
  displayModes,
  navigatorStandalone,
}: {
  displayModes: string[];
  navigatorStandalone: boolean;
}) {
  return (
    navigatorStandalone ||
    displayModes.some((mode) => standaloneDisplayModes.includes(mode as (typeof standaloneDisplayModes)[number]))
  );
}

export function buildWebAppInstallGuide({
  canPrompt,
  isInstalled,
  isDesktopViewport,
  maxTouchPoints,
  promptOutcome,
  userAgent,
}: WebAppInstallGuideInput): WebAppInstallGuide {
  if (isInstalled) {
    return {
      badge: "Установлено",
      title: "AeroChat уже открыт как веб-приложение",
      description:
        "Ярлык уже можно запускать отдельно от обычной вкладки браузера, без адресной строки и лишнего chrome.",
      steps: [],
      actionLabel: null,
      secondaryActionLabel: null,
      tone: "installed",
    };
  }

  if (canPrompt) {
    return {
      badge: "Готово к установке",
      title: "Установить AeroChat как приложение",
      description:
        promptOutcome === "dismissed"
          ? "Браузерный диалог был закрыт. Его можно открыть снова отсюда или воспользоваться меню браузера."
          : "На этом устройстве браузер может открыть штатный install prompt прямо из настроек.",
      steps: [
        "Нажмите кнопку установки ниже.",
        "Подтвердите стандартный диалог браузера.",
        "Запускайте AeroChat с рабочего стола, Dock или домашнего экрана как отдельное приложение.",
      ],
      actionLabel: "Установить AeroChat",
      secondaryActionLabel: "Показать запасной путь",
      tone: "ready",
    };
  }

  const platform = detectWebAppInstallPlatform({
    isDesktopViewport,
    maxTouchPoints,
    userAgent,
  });

  switch (platform) {
    case "ios":
      return {
        badge: "iPhone / iPad",
        title: "Добавьте AeroChat на экран Домой",
        description:
          "На iOS браузеры не дают открыть install prompt из страницы. Стандартный путь идёт через системное меню «Поделиться».",
        steps: [
          "Откройте AeroChat в Safari.",
          "Нажмите «Поделиться».",
          "Выберите «На экран Домой» и подтвердите добавление.",
        ],
        actionLabel: null,
        secondaryActionLabel: "Показать шаги",
        tone: "manual",
      };
    case "android":
      return {
        badge: "Android",
        title: "Добавьте AeroChat как ярлык приложения",
        description:
          "Если браузер не показал install prompt автоматически, используйте стандартное меню браузера на Android.",
        steps: [
          "Откройте меню браузера.",
          "Выберите «Установить приложение» или «Добавить на главный экран».",
          "Подтвердите создание ярлыка.",
        ],
        actionLabel: null,
        secondaryActionLabel: "Показать шаги",
        tone: "manual",
      };
    case "desktop-safari":
      return {
        badge: "Safari на Mac",
        title: "Добавьте AeroChat в Dock",
        description:
          "Safari устанавливает сайт как отдельное веб-приложение через системный путь macOS.",
        steps: [
          "Откройте AeroChat в Safari.",
          "В верхнем меню выберите «Файл» -> «Добавить в Dock».",
          "Подтвердите добавление и запускайте AeroChat из Dock или Launchpad.",
        ],
        actionLabel: null,
        secondaryActionLabel: "Показать шаги",
        tone: "manual",
      };
    case "desktop-chromium":
      return {
        badge: "Chrome / Edge",
        title: "Установите AeroChat через меню браузера",
        description:
          "Если встроенный prompt сейчас недоступен, Chrome-подобные браузеры всё равно умеют ставить ярлык вручную.",
        steps: [
          "Откройте меню браузера.",
          "Выберите «Установить AeroChat», «Установить приложение» или «Создать ярлык».",
          "Подтвердите открытие как отдельного приложения.",
        ],
        actionLabel: null,
        secondaryActionLabel: "Показать шаги",
        tone: "manual",
      };
    default:
      return {
        badge: isDesktopViewport ? "ПК / ноутбук" : "Телефон",
        title: "Откройте стандартное меню браузера",
        description:
          "У этого браузера нет прямого install prompt из страницы, поэтому установка идёт через его обычное меню.",
        steps: [
          "Откройте меню текущего браузера.",
          "Найдите пункт «Установить приложение», «Добавить на главный экран» или близкий по смыслу.",
          "Подтвердите создание ярлыка для AeroChat.",
        ],
        actionLabel: null,
        secondaryActionLabel: "Показать шаги",
        tone: "manual",
      };
  }
}

export function useWebAppInstall() {
  const isDesktopViewport = useDesktopShellViewport();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isPromptPending, setIsPromptPending] = useState(false);
  const [promptOutcome, setPromptOutcome] = useState<InstallPromptOutcome | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const mediaQuery = window.matchMedia(
      standaloneDisplayModes
        .map((mode) => `(display-mode: ${mode})`)
        .join(", "),
    );

    const syncInstalledState = () => {
      const activeDisplayModes = standaloneDisplayModes.filter((mode) =>
        window.matchMedia(`(display-mode: ${mode})`).matches
      );

      setIsInstalled(
        isInstalledWebApp({
          displayModes: activeDisplayModes,
          navigatorStandalone: readNavigatorStandalone(window.navigator),
        }),
      );
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      const installEvent = event as BeforeInstallPromptEvent;
      installEvent.preventDefault();
      setDeferredPrompt(installEvent);
      setPromptOutcome(null);
    };

    const handleInstalled = () => {
      setDeferredPrompt(null);
      setPromptOutcome("accepted");
      syncInstalledState();
    };

    syncInstalledState();

    const unsubscribeMediaQuery = subscribeToMediaQuery(mediaQuery, syncInstalledState);
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      unsubscribeMediaQuery();
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const guide = useMemo(() => {
    if (typeof navigator === "undefined") {
      return buildWebAppInstallGuide({
        canPrompt: false,
        isInstalled,
        isDesktopViewport,
        maxTouchPoints: 0,
        promptOutcome,
        userAgent: "",
      });
    }

    return buildWebAppInstallGuide({
      canPrompt: deferredPrompt !== null,
      isInstalled,
      isDesktopViewport,
      maxTouchPoints: navigator.maxTouchPoints ?? 0,
      promptOutcome,
      userAgent: navigator.userAgent,
    });
  }, [deferredPrompt, isDesktopViewport, isInstalled, promptOutcome]);

  async function requestInstall() {
    if (deferredPrompt === null || isPromptPending) {
      return false;
    }

    setIsPromptPending(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      setPromptOutcome(choice.outcome);
      if (choice.outcome === "accepted") {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
      return choice.outcome === "accepted";
    } finally {
      setIsPromptPending(false);
    }
  }

  return {
    canPrompt: deferredPrompt !== null,
    guide,
    isInstalled,
    isPromptPending,
    requestInstall,
  };
}

function readNavigatorStandalone(value: Navigator) {
  return "standalone" in value && value.standalone === true;
}

function subscribeToMediaQuery(
  mediaQuery: MediaQueryList,
  listener: () => void,
) {
  if ("addEventListener" in mediaQuery) {
    mediaQuery.addEventListener("change", listener);
    return () => {
      mediaQuery.removeEventListener("change", listener);
    };
  }

  const legacyMediaQuery = mediaQuery as MediaQueryList & {
    addListener(callback: () => void): void;
    removeListener(callback: () => void): void;
  };

  legacyMediaQuery.addListener(listener);
  return () => {
    legacyMediaQuery.removeListener(listener);
  };
}
