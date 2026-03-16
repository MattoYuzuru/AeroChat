import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { getAuthErrorMessage, useAuth } from "../auth/useAuth";
import {
  buildSettingsPatch,
  createSettingsForm,
  hasSettingsChanges,
  type SettingsForm,
} from "../settings/state";
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
  const { state, refreshProfile, updateProfile, clearNotice } = useAuth();
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

  return (
    <div className={styles.layout}>
      <section className={styles.heroCard}>
        <div className={styles.heroHeader}>
          <div>
            <p className={styles.cardLabel}>Settings</p>
            <h1 className={styles.title}>Приватность и личные предпочтения</h1>
            <p className={styles.subtitle}>
              Этот экран сохраняет только privacy flags и лёгкие account preferences через
              `aero-gateway`.
            </p>
          </div>

          <div className={styles.heroMeta}>
            <span className={styles.statusBadge}>{isDirty ? "есть несохранённые изменения" : "синхронизировано"}</span>
            <span className={styles.statusBadge}>gateway only</span>
            <span className={styles.statusBadge}>privacy snapshot</span>
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
            Запрашиваем актуальный профиль через gateway, чтобы экран не работал со старым snapshot.
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
                  Здесь остаются поля, которые естественно выглядят как settings, а не как публичная profile card.
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
                <span className={styles.metaChip}>{form.timezone.trim() === "" ? "timezone не задан" : form.timezone}</span>
                <span className={styles.metaChip}>
                  {form.profileAccent.trim() === "" ? "accent по умолчанию" : form.profileAccent}
                </span>
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
                  Обновить из gateway
                </button>
              </div>
            </section>
          </aside>
        </form>
      )}
    </div>
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
