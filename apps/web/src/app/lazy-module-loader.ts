import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export class ModuleLoadError extends Error {
  constructor() {
    super("Не удалось загрузить приложение.");
  }
}

export interface LazyModuleDescriptor<P extends object> {
  initialComponent: LazyExoticComponent<ComponentType<P>>;
  createComponent(onSettled?: () => void): LazyExoticComponent<ComponentType<P>>;
}

export function createLazyModule<P extends object = Record<string, never>>(
  load: () => Promise<{ default: ComponentType<P> }>,
): LazyModuleDescriptor<P> {
  function createComponent(onSettled?: () => void) {
    return lazy(async () => {
      try {
        return await load();
      } catch {
        throw new ModuleLoadError();
      } finally {
        onSettled?.();
      }
    });
  }
  return { initialComponent: createComponent(), createComponent };
}

