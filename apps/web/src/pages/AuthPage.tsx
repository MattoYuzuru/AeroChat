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
      <section className={styles.heroPanel}>
        <p className={styles.eyebrow}>AeroChat</p>
        <h1 className={styles.title}>Login application</h1>
        <p className={styles.copy}>
          Текущий auth flow уже входит в новую shell-направленность: вход и регистрация живут в
          том же визуальном языке, что и desktop runtime, но по-прежнему идут только через
          `aero-gateway`.
        </p>
        <ul className={styles.highlights}>
          <li>boot и chooser уже отделены от ежедневного fast-entry</li>
          <li>логин и регистрация остаются bounded app surfaces, а не marketing landing</li>
          <li>после валидного входа desktop shell становится primary desktop entrypoint</li>
        </ul>
      </section>

      <section className={styles.formPanel}>
        <div className={styles.formCard}>
          <p className={styles.eyebrow}>{isRegister ? "Регистрация" : "Вход"}</p>
          <h2 className={styles.formTitle}>
            {isRegister ? "Создать аккаунт" : "Войти в AeroChat"}
          </h2>

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
      </section>
    </main>
  );
}
