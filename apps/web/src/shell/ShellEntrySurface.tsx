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
          <span>AeroChat firmware shell</span>
          <span>{surface === "chooser" ? "preset selector" : "boot sequence"}</span>
        </div>
        <div className={styles.body}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.message}>{message}</p>
          <div className={styles.systemLines} aria-hidden="true">
            <span>checking shell registry ... ok</span>
            <span>loading xp-first desktop profile ... ok</span>
            <span>gateway session handoff ... pending</span>
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
        <p className={styles.footerHint}>
          {surface === "chooser"
            ? "Use arrows or choose a preset to continue."
            : "Boot will continue automatically when the current session is resolved."}
        </p>
      </section>
    </main>
  );
}
