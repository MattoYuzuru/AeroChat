import { Children, type ReactNode } from "react";
import type { Profile } from "../gateway/types";
import { describePersonProfileSummary } from "../people/profile-model";
import styles from "./PeoplePage.module.css";

export interface MetricProps {
  label: string;
  value: number;
}

export function Metric({ label, value }: MetricProps) {
  return (
    <div className={styles.metricCard}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export interface StateCardProps {
  title: string;
  message: string;
  action?: ReactNode;
  tone?: "default" | "error";
}

export function StateCard({
  title,
  message,
  action,
  tone = "default",
}: StateCardProps) {
  return (
    <section className={styles.stateCard} data-tone={tone}>
      <p className={styles.cardLabel}>People state</p>
      <h2 className={styles.stateTitle}>{title}</h2>
      <p className={styles.stateMessage}>{message}</p>
      {action && <div className={styles.stateActions}>{action}</div>}
    </section>
  );
}

export interface PeopleSectionProps {
  title: string;
  description: string;
  emptyMessage: string;
  children: ReactNode;
}

export function PeopleSection({
  title,
  description,
  emptyMessage,
  children,
}: PeopleSectionProps) {
  const items = Children.toArray(children);

  return (
    <section className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.cardLabel}>Список</p>
          <h2 className={styles.sectionTitle}>{title}</h2>
        </div>
        <p className={styles.sectionDescription}>{description}</p>
      </div>

      {items.length === 0 ? (
        <p className={styles.emptyState}>{emptyMessage}</p>
      ) : (
        <div className={styles.list}>{items}</div>
      )}
    </section>
  );
}

export interface ActionConfig {
  label: string;
  onClick(): void;
}

export interface ProfileCardProps {
  profile: Profile;
  metaLabel: string;
  onOpenProfile(): void;
  pendingLabel?: string;
  primaryAction?: ActionConfig;
  secondaryAction?: ActionConfig;
}

export function ProfileCard({
  profile,
  metaLabel,
  onOpenProfile,
  pendingLabel,
  primaryAction,
  secondaryAction,
}: ProfileCardProps) {
  const isPending = typeof pendingLabel === "string";

  return (
    <article className={styles.personCard}>
      <div className={styles.personHeader}>
        <div>
          <h3 className={styles.personTitle}>{profile.nickname}</h3>
          <p className={styles.personLogin}>@{profile.login}</p>
        </div>
        <div className={styles.actions}>
          <span className={styles.metaTag}>{metaLabel}</span>
          <button
            className={styles.secondaryButton}
            disabled={isPending}
            onClick={onOpenProfile}
            type="button"
          >
            Профиль
          </button>
        </div>
      </div>

      <p className={styles.personDescription}>{describePersonProfileSummary(profile)}</p>

      <div className={styles.actions}>
        {primaryAction && (
          <button
            className={styles.primaryButton}
            disabled={isPending}
            onClick={primaryAction.onClick}
            type="button"
          >
            {primaryAction.label}
          </button>
        )}
        {secondaryAction && (
          <button
            className={styles.secondaryButton}
            disabled={isPending}
            onClick={secondaryAction.onClick}
            type="button"
          >
            {secondaryAction.label}
          </button>
        )}
      </div>

      {pendingLabel && <p className={styles.pendingText}>{pendingLabel}</p>}
    </article>
  );
}
