import styles from "./AppShell.module.css";

const desktopCards = [
  {
    title: "Чаты",
    description: "Здесь позже появится список диалогов и групп.",
  },
  {
    title: "Контакты",
    description: "Здесь позже появится social graph и поиск по логину.",
  },
  {
    title: "Звонки",
    description: "Здесь позже появится control plane для RTC.",
  },
];

const statusItems = [
  "Foundation phase",
  "PWA-ready shell",
  "Proto-first contracts",
];

export function AppShell() {
  return (
    <div className={styles.shell}>
      <div className={styles.backdrop} aria-hidden="true" />

      <header className={styles.topBar}>
        <div>
          <p className={styles.eyebrow}>AeroChat</p>
          <h1 className={styles.title}>Desktop-like shell foundation</h1>
        </div>
        <div className={styles.statusCluster}>
          {statusItems.map((item) => (
            <span key={item} className={styles.statusChip}>
              {item}
            </span>
          ))}
        </div>
      </header>

      <main className={styles.workspace}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarCard}>
            <p className={styles.panelLabel}>Навигация</p>
            <ul className={styles.iconList}>
              <li>Почта</li>
              <li>Контакты</li>
              <li>Медиа</li>
              <li>Настройки</li>
            </ul>
          </div>

          <div className={styles.sidebarCard}>
            <p className={styles.panelLabel}>Статус окружения</p>
            <dl className={styles.metaGrid}>
              <div>
                <dt>Web</dt>
                <dd>React + Vite</dd>
              </div>
              <div>
                <dt>Gateway</dt>
                <dd>/healthz и /readyz</dd>
              </div>
              <div>
                <dt>Design</dt>
                <dd>Frutiger-ready tokens</dd>
              </div>
            </dl>
          </div>
        </aside>

        <section className={styles.desktopArea}>
          <div className={styles.heroWindow}>
            <div className={styles.windowHeader}>
              <span className={styles.windowDot} />
              <span className={styles.windowDot} />
              <span className={styles.windowDot} />
              <span className={styles.windowTitle}>workspace</span>
            </div>
            <div className={styles.windowBody}>
              <div>
                <p className={styles.panelLabel}>Текущее состояние</p>
                <p className={styles.heroText}>
                  Здесь намеренно нет продуктовой логики. Shell служит только
                  каркасом под будущие приложения AeroChat.
                </p>
              </div>
              <div className={styles.metrics}>
                <div>
                  <strong>5</strong>
                  <span>backend-сервисов</span>
                </div>
                <div>
                  <strong>4</strong>
                  <span>proto namespace</span>
                </div>
                <div>
                  <strong>0</strong>
                  <span>фич до Identity phase</span>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.cardGrid}>
            {desktopCards.map((card) => (
              <article key={card.title} className={styles.desktopCard}>
                <p className={styles.panelLabel}>{card.title}</p>
                <p>{card.description}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
