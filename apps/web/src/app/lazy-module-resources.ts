export interface LazyModuleResource {
  url: string;
  resources: string | null;
}

const timeoutMs = 10_000;
const maxBytes = 16_384;
const loadedStylesheets = new WeakSet<HTMLLinkElement>();

function sameOriginUrl(value: string, base: URL): URL {
  const url = new URL(value, base);
  if (url.origin !== window.location.origin || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("Invalid lazy resource URL");
  }
  return url;
}

export async function loadRetryStyles(resource: LazyModuleResource, attempt: number): Promise<URL> {
  const moduleUrl = sameOriginUrl(resource.url, new URL(window.location.href));
  if (moduleUrl.search) throw new Error("Invalid lazy module URL");
  if (resource.resources === null) return moduleUrl;
  const resourcesUrl = sameOriginUrl(resource.resources, moduleUrl);
  if (resourcesUrl.href !== moduleUrl.href + ".resources.json") throw new Error("Invalid lazy sidecar URL");
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(resourcesUrl, { credentials: "omit", redirect: "error", signal: controller.signal });
    if (!response.ok || response.url !== resourcesUrl.href || !response.body || !response.headers.get("content-type")?.startsWith("application/json")) {
      throw new Error("Lazy sidecar unavailable");
    }
    const reader = response.body.getReader();
    let bytes = 0;
    const decoder = new TextDecoder();
    let text = "";
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > maxBytes) throw new Error("Lazy sidecar exceeds limit");
        text += decoder.decode(item.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || !("module" in parsed) || !("css" in parsed) ||
      parsed.module !== decodeURIComponent(moduleUrl.pathname.split("/").at(-1) ?? "") ||
      !Array.isArray(parsed.css) || parsed.css.length > 64) throw new Error("Invalid lazy sidecar");
    const styles = parsed.css.map((value: unknown) => {
      if (typeof value !== "string" || value.length > 1024 || !/^(?:[\w.-]+\/)*[\w.-]+\.css$/.test(value)) {
        throw new Error("Invalid lazy CSS path");
      }
      const url = sameOriginUrl(value, moduleUrl);
      if (url.search || !url.pathname.startsWith(new URL(".", moduleUrl).pathname)) throw new Error("Invalid lazy CSS URL");
      return url;
    });
    await Promise.all(styles.map((url) => ensureStylesheet(url, attempt)));
    return moduleUrl;
  } finally {
    window.clearTimeout(timer);
  }
}

function ensureStylesheet(url: URL, attempt: number): Promise<void> {
  const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')];
  if (links.some((link) => {
    const current = new URL(link.href);
    current.searchParams.delete("aerochat_retry");
    return current.href === url.href && loadedStylesheets.has(link) && link.sheet !== null;
  })) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    const fresh = new URL(url);
    fresh.searchParams.set("aerochat_retry", String(attempt));
    link.rel = "stylesheet";
    link.href = fresh.href;
    const timer = window.setTimeout(() => settle(false), timeoutMs);
    function settle(loaded: boolean) {
      window.clearTimeout(timer);
      link.onload = null;
      link.onerror = null;
      if (loaded) { loadedStylesheets.add(link); resolve(); }
      else { link.remove(); reject(new Error("Lazy stylesheet unavailable")); }
    }
    link.onload = () => settle(true);
    link.onerror = () => settle(false);
    document.head.append(link);
  });
}
