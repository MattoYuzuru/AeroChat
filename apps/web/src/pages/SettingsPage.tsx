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
import { gatewayClient } from "../gateway/runtime";
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
import { useCryptoRuntime } from "../crypto/useCryptoRuntime";
import { useWebNotifications } from "../notifications/context";
import { useWebAppInstall } from "../pwa/install";
import styles from "./SettingsPage.module.css";

const privacyItems = [
  {
    key: "readReceiptsEnabled",
    title: "Отчёты о прочтении",
    description:
      "Показывать собеседникам, что вы прочитали сообщение.",
  },
  {
    key: "presenceEnabled",
    title: "Статус в сети",
    description:
      "Разрешить показывать, что вы сейчас в сети.",
  },
  {
    key: "typingVisibilityEnabled",
    title: "Индикатор набора",
    description:
      "Показывать, когда вы печатаете ответ в личном чате.",
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
  const cryptoRuntime = useCryptoRuntime();
  const webNotifications = useWebNotifications();
  const webAppInstall = useWebAppInstall();
  const [isUpdatingNotifications, setIsUpdatingNotifications] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [isWebAppGuideVisible, setIsWebAppGuideVisible] = useState(false);

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
            "Не удалось загрузить настройки.",
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

  const sessionToken = state.token;
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
            "Не удалось сохранить изменения.",
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
      `Закрыть выбранную сессию ${formatShortId(session.id)}? После этого потребуется войти снова.`,
    );
    if (!confirmed) {
      return;
    }

    await devices.revokeSession(session.id);
  }

  async function handleBrowserPushToggle(nextEnabled: boolean) {
    setNotificationsError(null);
    webNotifications.clearError();
    clearNotice();
    setIsUpdatingNotifications(true);

    try {
      if (nextEnabled) {
        const enabled = await webNotifications.ensureBrowserPush(sessionToken);
        if (!enabled) {
          throw new Error(
            webNotifications.error ??
              "Не удалось подготовить browser push для этого устройства.",
          );
        }

        await updateProfile({
          pushNotificationsEnabled: true,
        });
        return;
      }

      await updateProfile({
        pushNotificationsEnabled: false,
      });
      await webNotifications.disableBrowserPush(sessionToken);
    } catch (error) {
      setNotificationsError(
        getAuthErrorMessage(
          error,
          nextEnabled
            ? "Не удалось включить browser push."
            : "Не удалось выключить browser push.",
        ),
      );
    } finally {
      setIsUpdatingNotifications(false);
    }
  }

  async function handleSetAllNotifications(nextEnabled: boolean) {
    setNotificationsError(null);
    webNotifications.clearError();
    clearNotice();
    setIsUpdatingNotifications(true);

    try {
      if (nextEnabled && profile.pushNotificationsEnabled !== true) {
        const enabled = await webNotifications.ensureBrowserPush(sessionToken);
        if (!enabled) {
          throw new Error(
            webNotifications.error ??
              "Не удалось подготовить browser push для этого устройства.",
          );
        }

        await updateProfile({
          pushNotificationsEnabled: true,
        });
      }

      await gatewayClient.setAllNotifications(sessionToken, nextEnabled);
      await refreshProfile();
    } catch (error) {
      setNotificationsError(
        getAuthErrorMessage(
          error,
          nextEnabled
            ? "Не удалось включить уведомления для всех чатов."
            : "Не удалось отключить уведомления для всех чатов.",
        ),
      );
    } finally {
      setIsUpdatingNotifications(false);
    }
  }

  return (
    <div className={styles.layout}>
      <section className={styles.heroCard}>
        <div className={styles.heroHeader}>
          <div>
            <p className={styles.cardLabel}>Панель управления</p>
            <h1 className={styles.title}>Настройки</h1>
            <p className={styles.subtitle}>
              Приватность, профиль устройства и доступ к учётной записи в одном окне.
            </p>
          </div>

          <div className={styles.heroMeta}>
            <span className={styles.statusBadge}>
              {isDirty ? "есть несохранённые изменения" : "всё сохранено"}
            </span>
            <span className={styles.statusBadge}>приватность</span>
            <span className={styles.statusBadge}>устройства и доступ</span>
          </div>
        </div>

        {state.notice && <div className={styles.notice}>{state.notice}</div>}
        {saveError && <div className={styles.error}>{saveError}</div>}
        {loadError && !isLoading && <div className={styles.error}>{loadError}</div>}
      </section>

      {isLoading ? (
        <section className={styles.stateCard}>
          <p className={styles.cardLabel}>Загрузка</p>
          <h2 className={styles.stateTitle}>Загружаем настройки</h2>
          <p className={styles.stateMessage}>
            Получаем актуальные данные профиля и устройств.
          </p>
        </section>
      ) : loadError ? (
        <section className={styles.stateCard}>
          <p className={styles.cardLabel}>Ошибка</p>
          <h2 className={styles.stateTitle}>Настройки не загрузились</h2>
          <p className={styles.stateMessage}>
            Можно повторить загрузку без выхода из рабочего стола.
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
                  <p className={styles.cardLabel}>Приватность</p>
                  <h2 className={styles.sectionTitle}>Что видно собеседникам</h2>
                </div>
                <p className={styles.sectionDescription}>
                  Эти параметры управляют тем, что другие люди видят в личных чатах.
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
                      className={`${styles.toggleInput} xpCheckbox`}
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
                  <p className={styles.cardLabel}>Личные данные</p>
                  <h2 className={styles.sectionTitle}>Оформление профиля</h2>
                </div>
                <p className={styles.sectionDescription}>
                  Небольшие настройки, которые меняют только ваш профиль.
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
                    placeholder="Короткая подпись, которую увидят ваши контакты."
                    rows={3}
                    value={form.statusText}
                  />
                </label>
              </div>
            </section>

            <section className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.cardLabel}>Веб-приложение</p>
                  <h2 className={styles.sectionTitle}>Ярлык AeroChat без интерфейса браузера</h2>
                </div>
                <p className={styles.sectionDescription}>
                  Это не отдельный desktop wrapper и не offline mode. Здесь только штатная
                  установка ярлыка, чтобы AeroChat открывался как standalone web app.
                </p>
              </div>

              <section
                className={styles.inlineStateCard}
                data-tone={
                  webAppInstall.guide.tone === "installed" ? "success" : "default"
                }
              >
                <p className={styles.cardLabel}>{webAppInstall.guide.badge}</p>
                <h3 className={styles.stateTitle}>{webAppInstall.guide.title}</h3>
                <p className={styles.stateMessage}>{webAppInstall.guide.description}</p>

                <div className={styles.actions}>
                  {webAppInstall.guide.actionLabel && (
                    <button
                      className={styles.primaryButton}
                      disabled={webAppInstall.isPromptPending}
                      onClick={() => {
                        void webAppInstall.requestInstall();
                      }}
                      type="button"
                    >
                      {webAppInstall.isPromptPending
                        ? "Открываем системное окно..."
                        : webAppInstall.guide.actionLabel}
                    </button>
                  )}

                  {webAppInstall.guide.secondaryActionLabel && (
                    <button
                      className={styles.secondaryButton}
                      onClick={() => {
                        setIsWebAppGuideVisible((current) => !current);
                      }}
                      type="button"
                    >
                      {isWebAppGuideVisible
                        ? "Скрыть шаги"
                        : webAppInstall.guide.secondaryActionLabel}
                    </button>
                  )}
                </div>
              </section>

              {isWebAppGuideVisible && webAppInstall.guide.steps.length > 0 && (
                <section className={styles.inlineStateCard}>
                  <p className={styles.cardLabel}>Стандартный путь</p>
                  <ol className={styles.stepList}>
                    {webAppInstall.guide.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </section>
              )}
            </section>

            <section className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.cardLabel}>Уведомления</p>
                  <h2 className={styles.sectionTitle}>Browser push и охват чатов</h2>
                </div>
                <p className={styles.sectionDescription}>
                  Push работает только после разрешения браузера. Пока AeroChat открыт и видим,
                  системные уведомления не дублируются.
                </p>
              </div>

              {(notificationsError || webNotifications.error) && (
                <div className={styles.error}>
                  {notificationsError ?? webNotifications.error}
                </div>
              )}

              <div className={styles.toggleList}>
                <label className={styles.toggleCard}>
                  <div className={styles.toggleCopy}>
                    <strong>Браузерные уведомления</strong>
                    <span>
                      Разрешает доставку push на этот браузер для ПК и мобильных устройств.
                    </span>
                  </div>
                  <input
                    checked={profile.pushNotificationsEnabled === true}
                    className={`${styles.toggleInput} xpCheckbox`}
                    disabled={
                      isUpdatingNotifications || !webNotifications.isSupported
                    }
                    onChange={(event) => {
                      void handleBrowserPushToggle(event.target.checked);
                    }}
                    type="checkbox"
                  />
                </label>
              </div>

              <div className={styles.sectionToolbar}>
                <p className={styles.sectionDescription}>
                  Статус браузера:{" "}
                  {describeBrowserPushState(
                    webNotifications.isSupported,
                    webNotifications.permission,
                    webNotifications.subscriptionStatus,
                  )}
                </p>
                <div className={styles.actions}>
                  <button
                    className={styles.secondaryButton}
                    disabled={isUpdatingNotifications}
                    onClick={() => {
                      void handleSetAllNotifications(true);
                    }}
                    type="button"
                  >
                    ВКЛ везде
                  </button>
                  <button
                    className={styles.secondaryButton}
                    disabled={isUpdatingNotifications}
                    onClick={() => {
                      void handleSetAllNotifications(false);
                    }}
                    type="button"
                  >
                    ВЫКЛ везде
                  </button>
                </div>
              </div>
            </section>

            <section className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.cardLabel}>Устройства</p>
                  <h2 className={styles.sectionTitle}>Устройства и сессии</h2>
                </div>
                <div className={styles.sectionToolbar}>
                  <p className={styles.sectionDescription}>
                    Если вы входили на одном и том же компьютере несколько раз, ориентируйтесь по
                    идентификатору и времени активности.
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
                  detail="в списке"
                />
              </div>

              {devices.state.notice && <div className={styles.notice}>{devices.state.notice}</div>}
              {devices.state.actionErrorMessage && (
                <div className={styles.error}>{devices.state.actionErrorMessage}</div>
              )}

              {devices.state.status === "loading" && (
                <SectionStateCard
                  eyebrow="Устройства"
                  title="Загружаем список устройств"
                  message="Получаем актуальные устройства и связанные с ними сессии."
                />
              )}

              {devices.state.status === "error" && (
                <SectionStateCard
                  eyebrow="Устройства"
                  title="Устройства сейчас недоступны"
                  message={devices.state.screenErrorMessage ?? "Не удалось получить список."}
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
                  eyebrow="Устройства"
                  title="Список устройств пуст"
                  message="Для этой учётной записи пока нет отдельных записей об устройствах."
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
                                value={entry.device.revokedAt ? "отозвано" : "доступно"}
                              />
                            </div>
                            <p className={styles.deviceMeta}>
                              ID: {formatShortId(entry.device.id)} · добавлено{" "}
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
                              Для этого устройства пока нет отдельных записей о сессиях.
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
                                      <span>ID: {formatShortId(session.id)}</span>
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
              <p className={styles.cardLabel}>Учётная запись</p>
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
                  {form.timezone.trim() === "" ? "часовой пояс не указан" : form.timezone}
                </span>
                <span className={styles.metaChip}>
                  {form.profileAccent.trim() === ""
                    ? "акцент по умолчанию"
                    : form.profileAccent}
                </span>
              </div>
            </section>

            <section className={styles.summaryCard}>
              <p className={styles.cardLabel}>Сводка доступа</p>
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
                  <dd>Пока не выделяется отдельно</dd>
                </div>
              </div>
            </section>

            <section className={styles.summaryCard}>
              <p className={styles.cardLabel}>Шифрование</p>
              <h2 className={styles.summaryTitle}>Локальное устройство шифрования</h2>
              <p className={styles.summarySubtitle}>
                Этот блок показывает состояние локального устройства шифрования в браузере и
                связанных устройств аккаунта.
              </p>

              {cryptoRuntime.state.status === "bootstrapping" ? (
                <SectionStateCard
                  eyebrow="Шифрование"
                  title="Готовим локальное устройство"
                  message="Проверяем локальное хранилище ключей и список связанных устройств."
                />
              ) : cryptoRuntime.state.status === "ready" &&
                cryptoRuntime.state.snapshot !== null ? (
                <>
                  <div className={styles.metaGrid}>
                    <div>
                      <dt>Устройство в браузере</dt>
                      <dd>
                        {describeLocalCryptoDevice(cryptoRuntime.state.snapshot.localDevice)}
                      </dd>
                    </div>
                    <div>
                      <dt>Связанные устройства</dt>
                      <dd>{cryptoRuntime.state.snapshot.devices.length}</dd>
                    </div>
                    <div>
                      <dt>Ожидают подтверждения</dt>
                      <dd>
                        {
                          cryptoRuntime.state.snapshot.linkIntents.filter(
                            (intent) => intent.status === "pending",
                          ).length
                        }
                      </dd>
                    </div>
                  </div>

                  {cryptoRuntime.state.snapshot.notice && (
                    <div className={styles.notice}>
                      {cryptoRuntime.state.snapshot.notice}
                    </div>
                  )}
                  {cryptoRuntime.state.snapshot.errorMessage && (
                    <div className={styles.error}>
                      {cryptoRuntime.state.snapshot.errorMessage}
                    </div>
                  )}

                  <div className={styles.chipGroup}>
                    <span className={styles.metaChip}>
                      поддержка устройства: {cryptoRuntime.state.snapshot.support}
                    </span>
                    <span className={styles.metaChip}>
                      состояние: {cryptoRuntime.state.snapshot.phase}
                    </span>
                    {cryptoRuntime.state.snapshot.localDevice && (
                      <span className={styles.metaChip}>
                        пакет ключей v{cryptoRuntime.state.snapshot.localDevice.lastBundleVersion}
                      </span>
                    )}
                  </div>

                  {cryptoRuntime.state.snapshot.localDevice && (
                    <div className={styles.metaGrid}>
                      <div>
                        <dt>ID криптоустройства</dt>
                        <dd>
                          {formatShortId(
                            cryptoRuntime.state.snapshot.localDevice.cryptoDeviceId,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Bundle опубликован</dt>
                        <dd>
                          {cryptoRuntime.state.snapshot.localDevice.lastBundlePublishedAt
                            ? formatDateTime(
                                cryptoRuntime.state.snapshot.localDevice
                                  .lastBundlePublishedAt,
                              )
                            : "ещё нет"}
                        </dd>
                      </div>
                      <div>
                        <dt>Запрос привязки</dt>
                        <dd>
                          {cryptoRuntime.state.snapshot.localDevice.linkIntentId
                            ? formatShortId(
                                cryptoRuntime.state.snapshot.localDevice.linkIntentId,
                              )
                            : "не требуется"}
                        </dd>
                      </div>
                    </div>
                  )}

                  {cryptoRuntime.state.snapshot.canApproveLinkIntents &&
                    cryptoRuntime.state.snapshot.linkIntents.some(
                      (intent) => intent.status === "pending",
                    ) && (
                      <div className={styles.runtimeIntentList}>
                        {cryptoRuntime.state.snapshot.linkIntents
                          .filter((intent) => intent.status === "pending")
                          .map((intent) => (
                            <div className={styles.runtimeIntentRow} key={intent.id}>
                              <div className={styles.runtimeIntentCopy}>
                                <strong>
                                  Новое устройство {formatShortId(intent.pendingCryptoDeviceId)}
                                </strong>
                                <span>Запрос: {formatShortId(intent.id)}</span>
                                <span>Истекает: {formatDateTime(intent.expiresAt)}</span>
                              </div>
                              <button
                                className={styles.secondaryButton}
                                disabled={cryptoRuntime.state.isActionPending}
                                onClick={() => {
                                  void cryptoRuntime.approveLinkIntent(intent.id);
                                }}
                                type="button"
                              >
                                Подтвердить
                              </button>
                            </div>
                          ))}
                      </div>
                    )}

                  <div className={styles.actions}>
                    <button
                      className={styles.secondaryButton}
                      disabled={cryptoRuntime.state.isActionPending}
                      onClick={() => {
                        void cryptoRuntime.refresh();
                      }}
                      type="button"
                    >
                      {cryptoRuntime.state.pendingLabel ===
                      "Синхронизируем crypto runtime..."
                        ? "Синхронизируем..."
                        : "Обновить состояние"}
                    </button>
                    <button
                      className={styles.secondaryButton}
                      disabled={
                        cryptoRuntime.state.isActionPending ||
                        !cryptoRuntime.state.snapshot.canCreatePendingDevice
                      }
                      onClick={() => {
                        void cryptoRuntime.createPendingLinkedDevice();
                      }}
                      type="button"
                    >
                      {cryptoRuntime.state.pendingLabel ===
                      "Создаём pending crypto-device..."
                        ? cryptoRuntime.state.pendingLabel
                        : "Подготовить новое устройство"}
                    </button>
                    <button
                      className={styles.secondaryButton}
                      disabled={
                        cryptoRuntime.state.isActionPending ||
                        cryptoRuntime.state.snapshot.localDevice === null
                      }
                      onClick={() => {
                        void cryptoRuntime.publishCurrentBundle();
                      }}
                      type="button"
                    >
                      {cryptoRuntime.state.pendingLabel ===
                      "Публикуем текущий bundle..."
                        ? "Публикуем..."
                        : "Опубликовать пакет"}
                    </button>
                  </div>
                </>
              ) : null}
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
                  Отменить изменения
                </button>
                <button
                  className={styles.secondaryButton}
                  disabled={isSaving || isLoading}
                  onClick={() => {
                    void loadSettingsRef.current();
                  }}
                  type="button"
                >
                  Обновить данные
                </button>
              </div>
            </section>
          </aside>
        </form>
      )}
    </div>
  );
}

function describeBrowserPushState(
  isSupported: boolean,
  permission: NotificationPermission | "unsupported",
  subscriptionStatus: "idle" | "syncing" | "active" | "inactive",
) {
  if (!isSupported || permission === "unsupported") {
    return "текущий браузер не поддерживает push";
  }
  if (subscriptionStatus === "syncing") {
    return "синхронизируем subscription";
  }
  if (permission === "denied") {
    return "разрешение заблокировано браузером";
  }
  if (permission === "default") {
    return "разрешение ещё не выдано";
  }
  if (subscriptionStatus === "active") {
    return "push готов на этом устройстве";
  }

  return "разрешение выдано, но subscription ещё не активирована";
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
  eyebrow?: string;
  title: string;
  message: string;
  action?: ReactNode;
  tone?: "default" | "error";
}

function SectionStateCard({
  eyebrow = "Состояние",
  title,
  message,
  action,
  tone = "default",
}: SectionStateCardProps) {
  return (
    <section className={styles.inlineStateCard} data-tone={tone}>
      <p className={styles.cardLabel}>{eyebrow}</p>
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

function describeLocalCryptoDevice(
  device:
    | {
        status: "active" | "pending_link" | "revoked";
        deviceLabel: string;
      }
    | null,
): string {
  if (device === null) {
    return "не создан";
  }

  switch (device.status) {
    case "active":
      return `${device.deviceLabel} · готово`;
    case "pending_link":
      return `${device.deviceLabel} · ожидает привязки`;
    case "revoked":
      return `${device.deviceLabel} · отозвано`;
    default:
      return device.deviceLabel;
  }
}
