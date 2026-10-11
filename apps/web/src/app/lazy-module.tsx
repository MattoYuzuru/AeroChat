import {
  Component,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useDesktopShellHost } from "../shell/context";
import { ModuleLoadError, type LazyModuleDescriptor } from "./lazy-module-loader";
import styles from "./lazy-module.module.css";

class ModuleErrorBoundary extends Component<{
  children: ReactNode;
  failure: ReactNode;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(error: unknown) {
    if (!(error instanceof ModuleLoadError)) {
      throw error;
    }
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.failure : this.props.children;
  }
}

export function RetryableLazyModule<P extends object>({
  descriptor,
  title,
  moduleProps,
}: {
  descriptor: LazyModuleDescriptor<P>;
  title: string;
  moduleProps: P;
}) {
  const [attempt, setAttempt] = useState(() => ({ generation: 0, Component: descriptor.initialComponent }));
  const retryPendingRef = useRef(false);
  const shouldRestoreFocusRef = useRef(false);
  const host = useDesktopShellHost();
  const canRetry = useSyncExternalStore(descriptor.subscribe, descriptor.canRetry, descriptor.canRetry);
  const isActive = host === null || host.isCurrentWindowActive;
  const LoadedComponent = attempt.Component;

  function retry() {
    if (retryPendingRef.current || !descriptor.canRetry()) {
      return;
    }
    retryPendingRef.current = true;
    const nextComponent = descriptor.createComponent(() => {
      retryPendingRef.current = false;
    });
    setAttempt((previous) => ({ generation: previous.generation + 1, Component: nextComponent }));
  }

  const failure = <ModuleStatus title={title} isActive={isActive} onRetry={retry} canRetry={canRetry} onFocus={() => { shouldRestoreFocusRef.current = true; }} />;
  const pending = <ModuleStatus title={title} isActive={isActive} onFocus={() => { shouldRestoreFocusRef.current = true; }} />;

  return (
    <ModuleErrorBoundary key={attempt.generation} failure={failure}>
      <Suspense fallback={pending}>
        <ModuleContent isActive={isActive} restoreFocusRef={shouldRestoreFocusRef}>
          <LoadedComponent {...moduleProps} />
        </ModuleContent>
      </Suspense>
    </ModuleErrorBoundary>
  );
}

function ModuleStatus({ title, isActive, onRetry, canRetry = true, onFocus }: {
  title: string;
  isActive: boolean;
  onRetry?: () => void;
  canRetry?: boolean;
  onFocus(): void;
}) {
  const statusRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (isActive) {
      (statusRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? statusRef.current)?.focus();
    }
  }, [isActive]);
  return (
    <section className={styles.status} ref={statusRef} tabIndex={-1} onFocusCapture={onFocus} role={onRetry ? "alert" : "status"} aria-live={onRetry ? "assertive" : "polite"}>
      <h2>{onRetry ? `Не удалось загрузить: ${title}` : `Загрузка: ${title}`}</h2>
      <p>{onRetry ? canRetry ? "Проверьте подключение и повторите попытку." : "Повторные попытки исчерпаны. Сохраните доступные черновики перед ручной перезагрузкой страницы." : "Подготавливаем приложение."}</p>
      {onRetry && <button className={styles.retry} type="button" disabled={!canRetry} onClick={onRetry}>Повторить загрузку</button>}
    </section>
  );
}

function ModuleContent({ children, isActive, restoreFocusRef }: {
  children: ReactNode;
  isActive: boolean;
  restoreFocusRef: { current: boolean };
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isActive && restoreFocusRef.current && document.activeElement === document.body) {
      contentRef.current?.focus();
    }
    restoreFocusRef.current = false;
  }, [isActive, restoreFocusRef]);
  return <div className={styles.content} ref={contentRef} tabIndex={-1}>{children}</div>;
}
