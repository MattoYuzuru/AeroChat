import styles from "./StateScreen.module.css";

interface StateAction {
  label: string;
  onClick(): void | Promise<void>;
}

interface StateScreenProps {
  eyebrow: string;
  title: string;
  message: string;
  tone?: "loading" | "error";
  primaryAction?: StateAction;
  secondaryAction?: StateAction;
}

export function StateScreen({
  eyebrow,
  title,
  message,
  tone = "loading",
  primaryAction,
  secondaryAction,
}: StateScreenProps) {
  return (
    <main className={styles.viewport}>
      <section className={styles.card} data-tone={tone}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.message}>{message}</p>

        {(primaryAction || secondaryAction) && (
          <div className={styles.actions}>
            {primaryAction && (
              <button type="button" className={styles.primaryButton} onClick={primaryAction.onClick}>
                {primaryAction.label}
              </button>
            )}
            {secondaryAction && (
              <button type="button" className={styles.secondaryButton} onClick={secondaryAction.onClick}>
                {secondaryAction.label}
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
