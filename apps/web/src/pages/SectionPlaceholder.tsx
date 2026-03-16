import styles from "./SectionPlaceholder.module.css";

interface SectionPlaceholderProps {
  title: string;
  description: string;
  nextSlice: string;
}

export function SectionPlaceholder({
  title,
  description,
  nextSlice,
}: SectionPlaceholderProps) {
  return (
    <section className={styles.card}>
      <p className={styles.label}>Следующий слой</p>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.description}>{description}</p>
      <p className={styles.next}>{nextSlice}</p>
    </section>
  );
}
