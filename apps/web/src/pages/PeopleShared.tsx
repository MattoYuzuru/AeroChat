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
      <p className={styles.cardLabel}>Люди</p>
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
  tone?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}

export interface ProfileCardProps {
  profile: Profile;
  statusLabel: string;
  metaLabel: string;
  onOpenProfile(): void;
  pendingLabel?: string;
  primaryAction?: ActionConfig;
  secondaryAction?: ActionConfig;
}

export function ProfileCard({
  profile,
  statusLabel,
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
        <div className={styles.personIdentity}>
          {profile.avatarUrl ? (
            <img
              alt={`Аватар ${profile.nickname}`}
              className={styles.avatarImage}
              src={profile.avatarUrl}
            />
          ) : (
            <div className={styles.avatarBadge} aria-hidden="true">
              {getProfileInitials(profile)}
            </div>
          )}

          <div className={styles.personBody}>
            <div className={styles.personMetaRow}>
              <span className={styles.statusTag}>{statusLabel}</span>
              <span className={styles.metaTag}>{metaLabel}</span>
            </div>
            <h3 className={styles.personTitle}>{profile.nickname}</h3>
            <p className={styles.personLogin}>@{profile.login}</p>
            <p className={styles.personDescription}>{describePersonProfileSummary(profile)}</p>
          </div>
        </div>
        <div className={styles.profileAction}>
          <button
            className={styles.secondaryButton}
            disabled={isPending}
            onClick={onOpenProfile}
            type="button"
          >
            Открыть профиль
          </button>
        </div>
      </div>

      <div className={styles.actions}>
        {primaryAction && (
          <button
            className={resolveButtonClassName(primaryAction.tone ?? "primary")}
            disabled={isPending || primaryAction.disabled === true}
            onClick={primaryAction.onClick}
            type="button"
          >
            {primaryAction.label}
          </button>
        )}
        {secondaryAction && (
          <button
            className={resolveButtonClassName(secondaryAction.tone ?? "secondary")}
            disabled={isPending || secondaryAction.disabled === true}
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

function resolveButtonClassName(tone: "primary" | "secondary" | "danger"): string {
  switch (tone) {
    case "danger":
      return styles.dangerButton!;
    case "secondary":
      return styles.secondaryButton!;
    case "primary":
    default:
      return styles.primaryButton!;
  }
}

function getProfileInitials(profile: Profile): string {
  const source = profile.nickname.trim() || profile.login.trim() || "P";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }

  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}
