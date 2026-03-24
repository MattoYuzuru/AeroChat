import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { buildExplorerRoutePath } from "../app/app-routes";
import { readDesktopRegistryState } from "./desktop-registry";
import {
  buildMobileLauncherViewModel,
  type MobileLauncherPrimaryAppEntry,
} from "./mobile-launcher";
import { getBrowserShellPreferencesStorage } from "./preferences";
import { readStartMenuRecentItems } from "./start-menu";
import styles from "./MobileLauncherHome.module.css";

export function MobileLauncherHome() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [storage] = useState(() => getBrowserShellPreferencesStorage());
  const [desktopRegistryState] = useState(() => readDesktopRegistryState(storage));
  const [recentItems] = useState(() => readStartMenuRecentItems(storage));
  const viewModel = useMemo(
    () =>
      buildMobileLauncherViewModel({
        desktopRegistryState,
        recentItems,
      }),
    [desktopRegistryState, recentItems],
  );

  if (auth.state.status !== "authenticated") {
    return null;
  }

  function openPrimaryApp(entry: MobileLauncherPrimaryAppEntry) {
    navigate(entry.routePath);
  }

  return (
    <div className={styles.home}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Launcher home</p>
        <h1 className={styles.title}>Быстрый вход в AeroChat</h1>
        <p className={styles.subtitle}>
          @{auth.state.profile.login} · {auth.state.profile.nickname}
        </p>

        <div className={styles.quickActions}>
          {viewModel.primaryApps
            .filter(
              (entry) =>
                entry.appId === "chats" ||
                entry.appId === "groups" ||
                entry.appId === "search",
            )
            .map((entry) => (
              <button
                key={entry.appId}
                className={styles.primaryQuickButton}
                onClick={() => {
                  openPrimaryApp(entry);
                }}
                type="button"
              >
                {entry.title}
              </button>
            ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <p className={styles.sectionEyebrow}>Приложения</p>
          <span>{viewModel.primaryApps.length}</span>
        </div>

        <div className={styles.appGrid}>
          {viewModel.primaryApps.map((entry) => (
            <button
              key={entry.appId}
              className={styles.appCard}
              onClick={() => {
                openPrimaryApp(entry);
              }}
              type="button"
            >
              <span className={styles.appBadge}>{entry.badge}</span>
              <span className={styles.appTitle}>{entry.title}</span>
              <small>{entry.description}</small>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <p className={styles.sectionEyebrow}>Недавние</p>
          <span>{viewModel.recentItems.length}</span>
        </div>

        {viewModel.recentItems.length > 0 ? (
          <div className={styles.stack}>
            {viewModel.recentItems.map((entry) => (
              <button
                key={entry.id}
                className={styles.listCard}
                onClick={() => {
                  if (entry.routePath !== null) {
                    navigate(entry.routePath);
                  }
                }}
                type="button"
              >
                <span className={styles.listBadge}>{entry.badge}</span>
                <span className={styles.listContent}>
                  <span className={styles.listTitle}>{entry.title}</span>
                  <small>{entry.meta}</small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className={styles.emptyState}>
            Здесь появятся recent chats, groups и launcher apps после реальных переходов.
          </p>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <p className={styles.sectionEyebrow}>Папки</p>
          <span>{viewModel.folders.length}</span>
        </div>

        {viewModel.folders.length > 0 ? (
          <div className={styles.stack}>
            {viewModel.folders.map((folder) => (
              <button
                key={folder.folderId}
                className={styles.listCard}
                onClick={() => {
                  navigate(folder.routePath);
                }}
                type="button"
              >
                <span className={styles.listBadge}>П</span>
                <span className={styles.listContent}>
                  <span className={styles.listTitle}>{folder.title}</span>
                  <small>
                    {folder.memberCount === 0
                      ? "Папка пуста"
                      : `Объектов: ${folder.memberCount}${
                          folder.unreadCount > 0 ? ` · unread: ${folder.unreadCount}` : ""
                        }`}
                  </small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className={styles.emptyState}>
            Custom folders остаются shell-local и открываются через Explorer.
          </p>
        )}

        {viewModel.hiddenFolderCount > 0 && (
          <button
            className={styles.secondaryLink}
            onClick={() => {
              navigate(
                buildExplorerRoutePath(
                  new URLSearchParams([
                    ["section", "folders"],
                  ]),
                ),
              );
            }}
            type="button"
          >
            Открыть остальные папки: {viewModel.hiddenFolderCount}
          </button>
        )}
      </section>
    </div>
  );
}
