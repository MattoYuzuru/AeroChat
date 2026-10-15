import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { loadRetryStyles, type LazyModuleResource } from "./lazy-module-resources";

export class ModuleLoadError extends Error {
  constructor() {
    super("Не удалось загрузить приложение.");
  }
}

export interface LazyModuleDescriptor<P extends object> {
  initialComponent: LazyExoticComponent<ComponentType<P>>;
  createComponent(onSettled?: () => void): LazyExoticComponent<ComponentType<P>>;
  canRetry(): boolean;
  subscribe(listener: () => void): () => void;
}

export function createLazyModule<P extends object = Record<string, never>>(
  load: () => Promise<{ default: ComponentType<P> }>,
  resource: LazyModuleResource,
  exportName: string,
): LazyModuleDescriptor<P> {
  let retryCount = 0;
  let recovered: { default: ComponentType<P> } | null = null;
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const listeners = new Set<() => void>();
  let canonical = createComponent(false);

  function retryLoad() {
    if (recovered) return Promise.resolve(recovered);
    if (pending) return pending;
    if (retryCount >= 3) return Promise.reject(new ModuleLoadError());
    const attempt = ++retryCount;
    pending = (async () => {
      const url = await loadRetryStyles(resource, attempt);
      url.searchParams.set("aerochat_retry", String(attempt));
      const module = await import(/* @vite-ignore */ url.href);
      const component: unknown = module[exportName];
      if (typeof component !== "function") throw new ModuleLoadError();
      const result = { default: component as ComponentType<P> };
      recovered = result;
      canonical = lazy(() => Promise.resolve(result));
      return result;
    })().finally(() => {
      pending = null;
      for (const listener of listeners) listener();
    });
    return pending;
  }

  function createComponent(retry: boolean, onSettled?: () => void) {
    return lazy(async () => {
      try {
        const result = await (retry ? retryLoad() : load());
        recovered = result;
        return result;
      } catch {
        throw new ModuleLoadError();
      } finally {
        onSettled?.();
      }
    });
  }
  return {
    get initialComponent() { return canonical; },
    createComponent: (onSettled) => createComponent(true, onSettled),
    canRetry: () => recovered !== null || pending !== null || retryCount < 3,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
