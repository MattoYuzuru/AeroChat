import type { ReactNode } from "react";
import styles from "./ShellEntrySurface.module.css";

interface ShellEntrySurfaceProps {
  surface: "boot" | "chooser";
  eyebrow: string;
  title: string;
  message: string;
  actions?: ReactNode;
}

export function ShellEntrySurface({
  surface,
  eyebrow,
  title,
  message,
  actions = null,
}: ShellEntrySurfaceProps) {
  return (
    <main className={styles.viewport} data-surface={surface}>
      <section className={styles.screen}>
        <div className={styles.monitorNoise} aria-hidden="true" />
        <div className={styles.screenHeader}>
          <span>AeroChat</span>
          <span>{surface === "chooser" ? "Оформление" : "Запуск"}</span>
        </div>
        <div className={styles.body}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.message}>{message}</p>
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
        <p className={styles.footerHint}>
          {surface === "chooser"
            ? "Нажмите «Продолжить», чтобы открыть приложение."
            : "Приложение откроется автоматически после проверки сессии."}
        </p>
      </section>
    </main>
  );
}
