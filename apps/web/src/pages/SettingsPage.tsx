import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { getAuthErrorMessage, useAuth } from "../auth/useAuth";
import type { DeviceWithSessions, Session } from "../gateway/types";
import { getRevocationTargetKey } from "../settings/devices-state";
import {
  buildSettingsPatch,
  createSettingsForm,
  hasSettingsChanges,
  type SettingsForm,
} from "../settings/state";
import {
  countActiveDevices,
  countActiveSessions,
  useDevices,
} from "../settings/useDevices";
import styles from "./SettingsPage.module.css";

const privacyItems = [
  {
    key: "readReceiptsEnabled",
    title: "Чеки чтения",
    description:
      "Разрешить собеседникам видеть, что вы дочитали сообщение до конкретной позиции.",
  },
  {
    key: "presenceEnabled",
    title: "Presence",
    description:
      "Показывать snapshot вашего присутствия в direct chats без claims про realtime-поток.",
  },
  {
    key: "typingVisibilityEnabled",
    title: "Видимость набора",
    description:
      "Разрешить показывать собеседнику, что вы сейчас печатаете сообщение.",
  },
] satisfies Array<{
  key: keyof Pick<
    SettingsForm,
    "readReceiptsEnabled" | "presenceEnabled" | "typingVisibilityEnabled"
  >;
  title: string;
  description: string;
}>;

export function SettingsPage() {
  const {
    state,
    refreshProfile,
    updateProfile,
    clearNotice,
    expireSession,
  } = useAuth();
  const [form, setForm] = useState<SettingsForm>({
    timezone: "",
    profileAccent: "",
    statusText: "",
    readReceiptsEnabled: false,
    presenceEnabled: false,
    typingVisibilityEnabled: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const loadSettingsRef = useRef<() => Promise<void>>(async () => {});
  const devices = useDevices({
    enabled: state.status === "authenticated",
    token: state.status === "authenticated" ? state.token : "",
    onUnauthenticated: expireSession,
  });

  loadSettingsRef.current = async () => {
    clearNotice();
    setIsLoading(true);
    setLoadError(null);
    setSaveError(null);

    try {
      const nextProfile = await refreshProfile();
      if (!cancelledRef.current) {
        setForm(createSettingsForm(nextProfile));
      }
    } catch (error) {
      if (!cancelledRef.current) {
        setLoadError(
          getAuthErrorMessage(
            error,
            "Не удалось загрузить актуальные настройки через gateway.",
          ),
        );
      }
    } finally {
      if (!cancelledRef.current) {
        setIsLoading(false);
      }
    }
  };

  useEffect(
    () => () => {
      cancelledRef.current = true;
    },
    [],
  );

  useEffect(() => {
    if (state.status !== "authenticated") {
      return;
    }

    cancelledRef.current = false;
    void loadSettingsRef.current();
  }, [state.status]);

  if (state.status !== "authenticated") {
    return null;
  }

  const profile = state.profile;
  const isDirty = hasSettingsChanges(profile, form);

  function handlePrivacyChange(
    event: ChangeEvent<HTMLInputElement>,
    key: keyof Pick<
      SettingsForm,
      "readReceiptsEnabled" | "presenceEnabled" | "typingVisibilityEnabled"
    >,
  ) {
    setForm((current) => ({
      ...current,
      [key]: event.target.checked,
    }));
  }

  function handleReset() {
    clearNotice();
    setSaveError(null);
    setForm(createSettingsForm(profile));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setSaveError(null);
    clearNotice();

    try {
      const profile = await updateProfile(buildSettingsPatch(form));
      setForm(createSettingsForm(profile));
    } catch (error) {
      setSaveError(
        getAuthErrorMessage(
          error,
          "Не удалось сохранить настройки приватности и профиля.",
        ),
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRevokeDevice(entry: DeviceWithSessions) {
    const confirmed = window.confirm(
      `Отозвать устройство "${entry.device.label}" (${formatShortId(entry.device.id)})? Все его сессии станут недействительными.`,
    );
    if (!confirmed) {
      return;
    }

    await devices.revokeDevice(entry.device.id);
  }

  async function handleRevokeSession(session: Session) {
    const confirmed = window.confirm(
      `Закрыть выбранную сессию ${formatShortId(session.id)}? Она больше не сможет использовать текущий token.`,
    );
    if (!confirmed) {
      return;
    }

    await devices.revokeSession(session.id);
  }

  return (
    <div className={styles.layout}>
      <section className={styles.heroCard}>
        <div className={styles.heroHeader}>
          <div>
            <p className={styles.cardLabel}>Settings</p>
            <h1 className={styles.title}>Приватность, preferences и доступ</h1>
            <p className={styles.subtitle}>
              Этот экран управляет privacy flags, лёгкими account preferences и snapshot списком
              устройств только через `aero-gateway`.
            </p>
          </div>

          <div className={styles.heroMeta}>
            <span className={styles.statusBadge}>
              {isDirty ? "есть несохранённые изменения" : "синхронизировано"}
            </span>
            <span className={styles.statusBadge}>gateway only</span>
            <span className={styles.statusBadge}>devices & sessions</span>
          </div>
        </div>

        {state.notice && <div className={styles.notice}>{state.notice}</div>}
        {saveError && <div className={styles.error}>{saveError}</div>}
        {loadError && !isLoading && <div className={styles.error}>{loadError}</div>}
      </section>

      {isLoading ? (
        <section className={styles.stateCard}>
          <p className={styles.cardLabel}>Загрузка</p>
          <h2 className={styles.stateTitle}>Подтягиваем текущие настройки</h2>
          <p className={styles.stateMessage}>
            Запрашиваем актуальный профиль через gateway, чтобы экран не работал со старым
            snapshot.
          </p>
        </section>
      ) : loadError ? (
        <section className={styles.stateCard}>
          <p className={styles.cardLabel}>Ошибка</p>
          <h2 className={styles.stateTitle}>Настройки не загрузились</h2>
          <p className={styles.stateMessage}>
            Gateway ответил ошибкой. Можно повторить загрузку без выхода из защищённого shell.
          </p>
          <div className={styles.actions}>
            <button
              className={styles.primaryButton}
              onClick={() => {
                void loadSettingsRef.current();
              }}
              type="button"
            >
              Повторить загрузку
            </button>
          </div>
        </section>
      ) : (
        <form className={styles.workspace} onSubmit={handleSubmit}>
          <div className={styles.mainColumn}>
            <section className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.cardLabel}>Privacy</p>
                  <h2 className={styles.sectionTitle}>Поведение в direct chats</h2>
                </div>
                <p className={styles.sectionDescription}>
                  Эти флаги уже поддерживаются backend и влияют на snapshot-модель чатов.
                </p>
              </div>

              <div className={styles.toggleList}>
                {privacyItems.map((item) => (
                  <label key={item.key} className={styles.toggleCard}>
                    <div className={styles.toggleCopy}>
                      <strong>{item.title}</strong>
                      <span>{item.description}</span>
                    </div>
                    <input
                      checked={form[item.key]}
                      className={styles.toggleInput}
                      onChange={(event) => handlePrivacyChange(event, item.key)}
                      type="checkbox"
                    />
                  </label>
                ))}
              </div>
            </section>

            <section className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.cardLabel}>Preferences</p>
                  <h2 className={styles.sectionTitle}>Личное оформление и статус</h2>
                </div>
                <p className={styles.sectionDescription}>
                  Здесь остаются поля, которые естественно выглядят как settings, а не как
                  публичная profile card.
                </p>
              </div>

              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>Часовой пояс</span>
                  <input
                    maxLength={64}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        timezone: event.target.value,
                      }))
                    }
                    placeholder="Europe/Berlin"
                    value={form.timezone}
                  />
                </label>

                <label className={styles.field}>
                  <span>Акцент профиля</span>
                  <input
                    maxLength={64}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        profileAccent: event.target.value,
                      }))
                    }
                    placeholder="ice-blue"
                    value={form.profileAccent}
                  />
                </label>

                <label className={`${styles.field} ${styles.fullWidth}`}>
                  <span>Статус</span>
                  <textarea
                    maxLength={140}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        statusText: event.target.value,
                      }))
                    }
                    placeholder="Короткая строка, которую можно показать в people и profile snapshot."
                    rows={3}
                    value={form.statusText}
                  />
                </label>
              </div>
            </section>

            <section className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.cardLabel}>Devices</p>
                  <h2 className={styles.sectionTitle}>Устройства и сессии</h2>
                </div>
                <div className={styles.sectionToolbar}>
                  <p className={styles.sectionDescription}>
                    Список загружается только через `IdentityService` на gateway. Текущая сессия
                    не выделяется, потому что web bootstrap хранит только bearer token, а не
                    hydrated session/device snapshot. Повторный вход с той же меткой вроде
                    `Laptop` создаёт новую device record, поэтому ориентируйтесь по `Device ID` и
                    времени создания, а не только по label.
                  </p>
                  <button
                    className={styles.secondaryButton}
                    disabled={
                      devices.state.status === "loading" || devices.state.isRefreshing
                    }
                    onClick={() => {
                      void devices.reload();
                    }}
                    type="button"
                  >
                    {devices.state.isRefreshing ? "Обновляем..." : "Обновить список"}
                  </button>
                </div>
              </div>

              <div className={styles.metrics}>
                <MetricCard
                  label="Устройства"
                  value={countActiveDevices(devices.state.devices)}
                  detail="активных"
                />
                <MetricCard
                  label="Сессии"
                  value={countActiveSessions(devices.state.devices)}
                  detail="активных"
                />
                <MetricCard
                  label="Всего записей"
                  value={devices.state.devices.length}
                  detail="device cards"
                />
              </div>

              {devices.state.notice && <div className={styles.notice}>{devices.state.notice}</div>}
              {devices.state.actionErrorMessage && (
                <div className={styles.error}>{devices.state.actionErrorMessage}</div>
              )}

              {devices.state.status === "loading" && (
                <SectionStateCard
                  title="Подтягиваем список устройств"
                  message="Запрашиваем текущий snapshot устройств и связанных сессий через gateway."
                />
              )}

              {devices.state.status === "error" && (
                <SectionStateCard
                  title="Устройства сейчас недоступны"
                  message={
                    devices.state.screenErrorMessage ??
                    "Не удалось получить список устройств через gateway."
                  }
                  action={
                    <button
                      className={styles.primaryButton}
                      onClick={() => {
                        void devices.reload();
                      }}
                      type="button"
                    >
                      Повторить
                    </button>
                  }
                  tone="error"
                />
              )}

              {devices.state.status === "ready" && devices.state.devices.length === 0 && (
                <SectionStateCard
                  title="Список устройств пуст"
                  message="Backend не вернул ни одного устройства для текущего аккаунта. В этом slice данные не придумываются локально."
                />
              )}

              {devices.state.status === "ready" && devices.state.devices.length > 0 && (
                <div className={styles.deviceList}>
                  {devices.state.devices.map((entry) => {
                    const devicePendingLabel =
                      devices.state.pendingTargets[
                        getRevocationTargetKey({
                          kind: "device",
                          deviceId: entry.device.id,
                        })
                      ] ?? null;

                    return (
                      <article className={styles.deviceCard} key={entry.device.id}>
                        <div className={styles.deviceHeader}>
                          <div className={styles.deviceCopy}>
                            <div className={styles.deviceTitleRow}>
                              <h3 className={styles.deviceTitle}>{entry.device.label}</h3>
                              <StatusPill
                                tone={entry.device.revokedAt ? "danger" : "default"}
                                value={entry.device.revokedAt ? "отозвано" : "активно"}
                              />
                            </div>
                            <p className={styles.deviceMeta}>
                              Device ID: {formatShortId(entry.device.id)} · создано{" "}
                              {formatDateTime(entry.device.createdAt)}
                            </p>
                          </div>

                          <button
                            className={styles.dangerButton}
                            disabled={
                              entry.device.revokedAt !== null || devicePendingLabel !== null
                            }
                            onClick={() => {
                              void handleRevokeDevice(entry);
                            }}
                            type="button"
                          >
                            {devicePendingLabel ?? "Отозвать устройство"}
                          </button>
                        </div>

                        <dl className={styles.deviceFacts}>
                          <div>
                            <dt>Создано</dt>
                            <dd>{formatDateTime(entry.device.createdAt)}</dd>
                          </div>
                          <div>
                            <dt>Последняя активность</dt>
                            <dd>{formatDateTime(entry.device.lastSeenAt)}</dd>
                          </div>
                          <div>
                            <dt>Статус</dt>
                            <dd>
                              {entry.device.revokedAt
                                ? `Отозвано ${formatDateTime(entry.device.revokedAt)}`
                                : "Активно"}
                            </dd>
                          </div>
                        </dl>

                        <div className={styles.sessionBlock}>
                          <div className={styles.sessionHeader}>
                            <strong>Сессии устройства</strong>
                            <span>{entry.sessions.length}</span>
                          </div>

                          {entry.sessions.length === 0 ? (
                            <div className={styles.sessionEmpty}>
                              Для этого устройства backend пока не вернул отдельных session rows.
                            </div>
                          ) : (
                            <div className={styles.sessionList}>
                              {entry.sessions.map((session, index) => {
                                const sessionPendingLabel =
                                  devices.state.pendingTargets[
                                    getRevocationTargetKey({
                                      kind: "session",
                                      sessionId: session.id,
                                    })
                                  ] ?? null;

                                return (
                                  <div className={styles.sessionRow} key={session.id}>
                                    <div className={styles.sessionCopy}>
                                      <div className={styles.sessionTitleRow}>
                                        <strong>Сессия {index + 1}</strong>
                                        <StatusPill
                                          tone={session.revokedAt ? "danger" : "default"}
                                          value={session.revokedAt ? "закрыта" : "активна"}
                                        />
                                      </div>
                                      <span>Session ID: {formatShortId(session.id)}</span>
                                      <span>Создана: {formatDateTime(session.createdAt)}</span>
                                      <span>
                                        Последняя активность: {formatDateTime(session.lastSeenAt)}
                                      </span>
                                      {session.revokedAt && (
                                        <span>Отозвана: {formatDateTime(session.revokedAt)}</span>
                                      )}
                                    </div>

                                    <button
                                      className={styles.sessionButton}
                                      disabled={
                                        session.revokedAt !== null ||
                                        entry.device.revokedAt !== null ||
                                        sessionPendingLabel !== null
                                      }
                                      onClick={() => {
                                        void handleRevokeSession(session);
                                      }}
                                      type="button"
                                    >
                                      {sessionPendingLabel ?? "Закрыть сессию"}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <aside className={styles.sideColumn}>
            <section className={styles.summaryCard}>
              <p className={styles.cardLabel}>Текущий контекст</p>
              <h2 className={styles.summaryTitle}>{profile.nickname}</h2>
              <p className={styles.summarySubtitle}>@{profile.login}</p>

              <dl className={styles.metaGrid}>
                <div>
                  <dt>Обновлён</dt>
                  <dd>{formatDateTime(profile.updatedAt)}</dd>
                </div>
                <div>
                  <dt>Резерв ключей</dt>
                  <dd>{profile.keyBackupStatus}</dd>
                </div>
                <div>
                  <dt>Статус</dt>
                  <dd>{form.statusText.trim() === "" ? "не задан" : form.statusText}</dd>
                </div>
              </dl>

              <div className={styles.chipGroup}>
                <span className={styles.metaChip}>
                  {form.timezone.trim() === "" ? "timezone не задан" : form.timezone}
                </span>
                <span className={styles.metaChip}>
                  {form.profileAccent.trim() === ""
                    ? "accent по умолчанию"
                    : form.profileAccent}
                </span>
              </div>
            </section>

            <section className={styles.summaryCard}>
              <p className={styles.cardLabel}>Session snapshot</p>
              <div className={styles.metaGrid}>
                <div>
                  <dt>Активные устройства</dt>
                  <dd>{countActiveDevices(devices.state.devices)}</dd>
                </div>
                <div>
                  <dt>Активные сессии</dt>
                  <dd>{countActiveSessions(devices.state.devices)}</dd>
                </div>
                <div>
                  <dt>Текущая сессия</dt>
                  <dd>Не определяется в этом slice</dd>
                </div>
              </div>
            </section>

            <section className={styles.summaryCard}>
              <p className={styles.cardLabel}>Действия</p>
              <div className={styles.actions}>
                <button
                  className={styles.primaryButton}
                  disabled={isSaving || isLoading || !isDirty}
                  type="submit"
                >
                  {isSaving ? "Сохраняем..." : "Сохранить настройки"}
                </button>
                <button
                  className={styles.secondaryButton}
                  disabled={isSaving || isLoading || !isDirty}
                  onClick={handleReset}
                  type="button"
                >
                  Сбросить локальные изменения
                </button>
                <button
                  className={styles.secondaryButton}
                  disabled={isSaving || isLoading}
                  onClick={() => {
                    void loadSettingsRef.current();
                  }}
                  type="button"
                >
                  Обновить профиль из gateway
                </button>
              </div>
            </section>
          </aside>
        </form>
      )}
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: number;
  detail: string;
}

function MetricCard({ label, value, detail }: MetricCardProps) {
  return (
    <div className={styles.metricCard}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

interface SectionStateCardProps {
  title: string;
  message: string;
  action?: ReactNode;
  tone?: "default" | "error";
}

function SectionStateCard({
  title,
  message,
  action,
  tone = "default",
}: SectionStateCardProps) {
  return (
    <section className={styles.inlineStateCard} data-tone={tone}>
      <p className={styles.cardLabel}>Devices state</p>
      <h3 className={styles.stateTitle}>{title}</h3>
      <p className={styles.stateMessage}>{message}</p>
      {action && <div className={styles.actions}>{action}</div>}
    </section>
  );
}

interface StatusPillProps {
  tone: "default" | "danger";
  value: string;
}

function StatusPill({ tone, value }: StatusPillProps) {
  return (
    <span className={styles.statusPill} data-tone={tone}>
      {value}
    </span>
  );
}

function formatDateTime(value: string): string {
  if (value.trim() === "") {
    return "неизвестно";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatShortId(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    return "неизвестно";
  }

  if (trimmed.length <= 12) {
    return trimmed;
  }

  return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`;
}
