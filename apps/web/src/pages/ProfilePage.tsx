import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { getAuthErrorMessage, useAuth } from "../auth/useAuth";
import styles from "./ProfilePage.module.css";

const emptyForm = {
  nickname: "",
  avatarUrl: "",
  bio: "",
  birthday: "",
  country: "",
  city: "",
};

export function ProfilePage() {
  const { state, updateProfile, clearNotice } = useAuth();
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (state.status !== "authenticated") {
      return;
    }

    setForm({
      nickname: state.profile.nickname,
      avatarUrl: state.profile.avatarUrl ?? "",
      bio: state.profile.bio ?? "",
      birthday: state.profile.birthday ?? "",
      country: state.profile.country ?? "",
      city: state.profile.city ?? "",
    });
  }, [state]);

  if (state.status !== "authenticated") {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setErrorMessage(null);
    clearNotice();

    try {
      await updateProfile(form);
    } catch (error) {
      setErrorMessage(
        getAuthErrorMessage(
          error,
          "Не удалось обновить текущий профиль через gateway.",
        ),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className={styles.layout}>
      <section className={styles.summaryCard}>
        <p className={styles.cardLabel}>Текущий профиль</p>
        <h1 className={styles.title}>{state.profile.nickname}</h1>
        <p className={styles.subtitle}>@{state.profile.login}</p>

        <dl className={styles.metaGrid}>
          <div>
            <dt>Создан</dt>
            <dd>{formatDateTime(state.profile.createdAt)}</dd>
          </div>
          <div>
            <dt>Обновлён</dt>
            <dd>{formatDateTime(state.profile.updatedAt)}</dd>
          </div>
          <div>
            <dt>Резерв ключей</dt>
            <dd>{state.profile.keyBackupStatus}</dd>
          </div>
        </dl>

        <div className={styles.flags}>
          <span>Timezone: {state.profile.timezone ?? "не задан"}</span>
          <span>Accent: {state.profile.profileAccent ?? "по умолчанию"}</span>
          <span>Status: {state.profile.statusText ?? "не задан"}</span>
        </div>

        <div className={styles.settingsCard}>
          <p className={styles.settingsLabel}>Настройки вынесены отдельно</p>
          <p className={styles.settingsDescription}>
            Приватность, timezone, profile accent и status text теперь редактируются на
            `/app/settings`, чтобы profile flow оставался про публичную карточку пользователя.
          </p>
          <Link className={styles.settingsLink} to="/app/settings">
            Открыть настройки
          </Link>
        </div>
      </section>

      <section className={styles.formCard}>
        <div className={styles.cardHeader}>
          <div>
            <p className={styles.cardLabel}>Редактирование</p>
            <h2 className={styles.formTitle}>Базовые поля профиля</h2>
          </div>
          {state.notice && <div className={styles.notice}>{state.notice}</div>}
          {errorMessage && <div className={styles.error}>{errorMessage}</div>}
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>Никнейм</span>
            <input
              maxLength={64}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  nickname: event.target.value,
                }))
              }
              required
              value={form.nickname}
            />
          </label>

          <label className={styles.field}>
            <span>URL аватара</span>
            <input
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  avatarUrl: event.target.value,
                }))
              }
              type="url"
              value={form.avatarUrl}
            />
          </label>

          <label className={`${styles.field} ${styles.fullWidth}`}>
            <span>О себе</span>
            <textarea
              maxLength={500}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  bio: event.target.value,
                }))
              }
              rows={4}
              value={form.bio}
            />
          </label>

          <label className={styles.field}>
            <span>Дата рождения</span>
            <input
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  birthday: event.target.value,
                }))
              }
              pattern="\\d{4}-\\d{2}-\\d{2}"
              placeholder="2001-02-03"
              value={form.birthday}
            />
          </label>

          <label className={styles.field}>
            <span>Страна</span>
            <input
              maxLength={64}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  country: event.target.value,
                }))
              }
              value={form.country}
            />
          </label>

          <label className={styles.field}>
            <span>Город</span>
            <input
              maxLength={64}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  city: event.target.value,
                }))
              }
              value={form.city}
            />
          </label>

          <div className={`${styles.actions} ${styles.fullWidth}`}>
            <button className={styles.primaryButton} disabled={isSaving} type="submit">
              {isSaving ? "Сохраняем..." : "Сохранить профиль"}
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() =>
                setForm({
                  nickname: state.profile.nickname,
                  avatarUrl: state.profile.avatarUrl ?? "",
                  bio: state.profile.bio ?? "",
                  birthday: state.profile.birthday ?? "",
                  country: state.profile.country ?? "",
                  city: state.profile.city ?? "",
                })
              }
              type="button"
            >
              Сбросить изменения
            </button>
          </div>
        </form>
      </section>
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
