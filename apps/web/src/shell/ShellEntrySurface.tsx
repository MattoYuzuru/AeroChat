import type { ReactNode } from "react";
import styles from "./ShellEntrySurface.module.css";

interface ShellEntrySurfaceProps {
  eyebrow: string;
  title: string;
  message: string;
  actions?: ReactNode;
}

export function ShellEntrySurface({
  eyebrow,
  title,
  message,
  actions = null,
}: ShellEntrySurfaceProps) {
  return (
    <main className={styles.viewport}>
      <div className={styles.wallpaper} aria-hidden="true" />
      <section className={styles.frame}>
        <div className={styles.headerBar}>
          <span className={styles.headerBrand}>AeroChat</span>
          <span className={styles.headerMeta}>XP-first shell runtime</span>
        </div>
        <div className={styles.body}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.message}>{message}</p>
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      </section>
    </main>
  );
}
