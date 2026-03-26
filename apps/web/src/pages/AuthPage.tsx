import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getAuthErrorMessage, useAuth } from "../auth/useAuth";
import styles from "./AuthPage.module.css";

interface AuthPageProps {
  mode: "login" | "register";
}

export function AuthPage({ mode }: AuthPageProps) {
  const navigate = useNavigate();
  const { login, register, state, clearNotice } = useAuth();
  const [form, setForm] = useState({
    login: "",
    password: "",
    nickname: "",
    deviceLabel: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isRegister = mode === "register";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    clearNotice();

    try {
      if (isRegister) {
        await register(form);
      } else {
        await login(form);
      }

      navigate("/app", { replace: true });
    } catch (error) {
      setErrorMessage(
        getAuthErrorMessage(
          error,
          isRegister
            ? "Не удалось завершить регистрацию через gateway."
            : "Не удалось выполнить вход через gateway.",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.viewport}>
      <div className={styles.shellBar} aria-hidden="true" />

      <section className={styles.formPanel}>
        <div className={styles.formCard}>
          <div className={styles.userTile}>
            <div className={styles.avatarFrame}>
              <div className={styles.avatarBadge}>{isRegister ? "A+" : "A"}</div>
            </div>
            <div className={styles.userMeta}>
              <p className={styles.modeLabel}>{isRegister ? "Регистрация" : "Вход"}</p>
              <h1 className={styles.formTitle}>
                {isRegister ? "Создать учётную запись" : "Войти в AeroChat"}
              </h1>
            </div>
          </div>

          {state.notice && <div className={styles.notice}>{state.notice}</div>}
          {errorMessage && <div className={styles.error}>{errorMessage}</div>}

          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.field}>
              <span>Логин</span>
              <input
                autoCapitalize="off"
                autoComplete={isRegister ? "username" : "username"}
                autoCorrect="off"
                name="login"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    login: event.target.value,
                  }))
                }
                placeholder="alice.test"
                required
                value={form.login}
              />
            </label>

            {isRegister && (
              <label className={styles.field}>
                <span>Никнейм</span>
                <input
                  autoComplete="nickname"
                  name="nickname"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      nickname: event.target.value,
                    }))
                  }
                  placeholder="Alice"
                  required
                  value={form.nickname}
                />
              </label>
            )}

            <label className={styles.field}>
              <span>Пароль</span>
              <input
                autoComplete={isRegister ? "new-password" : "current-password"}
                minLength={8}
                name="password"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                required
                type="password"
                value={form.password}
              />
            </label>

            <label className={styles.field}>
              <span>Метка устройства</span>
              <input
                autoComplete="off"
                name="deviceLabel"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    deviceLabel: event.target.value,
                  }))
                }
                placeholder="Веб-клиент"
                value={form.deviceLabel}
              />
            </label>

            <button className={styles.submitButton} disabled={submitting} type="submit">
              {submitting
                ? "Обработка..."
                : isRegister
                  ? "Зарегистрироваться"
                  : "Войти"}
            </button>
          </form>

          <p className={styles.switchText}>
            {isRegister ? "Уже есть аккаунт?" : "Нет аккаунта?"}{" "}
            <Link to={isRegister ? "/login" : "/register"}>
              {isRegister ? "Перейти ко входу" : "Перейти к регистрации"}
            </Link>
          </p>
        </div>

        <p className={styles.footerBrand}>AeroChat</p>
      </section>
    </main>
  );
}
