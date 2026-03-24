import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import {
  buildDirectChatRoutePath,
  buildExplorerRoutePath,
  buildGroupChatRoutePath,
  buildSelfChatRoutePath,
} from "../app/app-routes";
import { gatewayClient } from "../gateway/runtime";
import {
  buildExplorerSectionViewModel,
  explorerSections,
  resolveExplorerSection,
  type ExplorerSectionId,
} from "../shell/explorer-model";
import { useDesktopShellHost } from "../shell/context";
import {
  hideDesktopEntity,
  readDesktopRegistryState,
  showDesktopEntityOnDesktop,
  syncDirectChatDesktopEntities,
  syncGroupChatDesktopEntities,
  writeDesktopRegistryState,
  type DesktopEntity,
  type DesktopRegistryState,
} from "../shell/desktop-registry";
import { getBrowserShellPreferencesStorage } from "../shell/preferences";
import styles from "./ExplorerPage.module.css";

export function ExplorerPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const desktopShellHost = useDesktopShellHost();
  const [storage] = useState(() => getBrowserShellPreferencesStorage());
  const [localRegistryState, setLocalRegistryState] = useState<DesktopRegistryState>(() =>
    readDesktopRegistryState(storage),
  );

  const searchParams = new URLSearchParams(location.search);
  const currentSection = resolveExplorerSection(searchParams.get("section"));
  const registryState = desktopShellHost?.desktopRegistryState ?? localRegistryState;
  const viewModel = buildExplorerSectionViewModel(registryState, currentSection);
  const authenticatedState = auth.state.status === "authenticated" ? auth.state : null;

  useEffect(() => {
    if (desktopShellHost !== null || authenticatedState === null) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const [directChats, groups] = await Promise.all([
          gatewayClient.listDirectChats(authenticatedState.token),
          gatewayClient.listGroups(authenticatedState.token),
        ]);
        if (cancelled) {
          return;
        }

        setLocalRegistryState((currentState) =>
          syncGroupChatDesktopEntities(
            syncDirectChatDesktopEntities(
              currentState,
              directChats,
              authenticatedState.profile.id,
            ),
            groups,
          ),
        );
      } catch {
        // Explorer читает shell-local organizer state и не должен падать,
        // если bootstrap registry временно не удалось синхронизировать.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authenticatedState, desktopShellHost]);

  useEffect(() => {
    if (desktopShellHost !== null) {
      return;
    }

    writeDesktopRegistryState(storage, localRegistryState);
  }, [desktopShellHost, localRegistryState, storage]);

  function openSection(sectionId: ExplorerSectionId) {
    const nextSearchParams = new URLSearchParams();
    if (sectionId !== "desktop") {
      nextSearchParams.set("section", sectionId);
    }

    navigate(buildExplorerRoutePath(nextSearchParams));
  }

  function openSystemApp(appId: "self_chat" | "friend_requests" | "search" | "settings") {
    if (desktopShellHost !== null) {
      desktopShellHost.launchApp(appId);
      return;
    }

    if (appId === "self_chat") {
      navigate(buildSelfChatRoutePath());
      return;
    }

    if (appId === "friend_requests") {
      navigate("/app/friend-requests");
      return;
    }

    if (appId === "search") {
      navigate("/app/search");
      return;
    }

    navigate("/app/settings");
  }

  function openEntry(entry: DesktopEntity) {
    if (entry.kind === "system_app") {
      if (entry.appId === "explorer") {
        openSection("desktop");
        return;
      }

      openSystemApp(entry.appId);
      return;
    }

    if (entry.kind === "direct_chat") {
      if (desktopShellHost !== null) {
        desktopShellHost.openDirectChat({
          chatId: entry.targetKey,
          title: entry.title,
        });
        return;
      }

      navigate(buildDirectChatRoutePath(entry.targetKey));
      return;
    }

    if (desktopShellHost !== null) {
      desktopShellHost.openGroupChat({
        groupId: entry.targetKey,
        title: entry.title,
      });
      return;
    }

    navigate(buildGroupChatRoutePath(entry.targetKey));
  }

  function showEntry(entryId: string) {
    if (desktopShellHost !== null) {
      desktopShellHost.showDesktopEntry(entryId);
      return;
    }

    setLocalRegistryState((currentState) => showDesktopEntityOnDesktop(currentState, entryId));
  }

  function hideEntry(entryId: string) {
    if (desktopShellHost !== null) {
      desktopShellHost.hideDesktopEntry(entryId);
      return;
    }

    setLocalRegistryState((currentState) => hideDesktopEntity(currentState, entryId));
  }

  return (
    <div className={styles.surface}>
      <aside className={styles.sidebar} aria-label="Explorer navigation">
        <div className={styles.sidebarHeader}>
          <p className={styles.sidebarEyebrow}>Explorer</p>
          <h1 className={styles.sidebarTitle}>Организация shell entrypoints</h1>
          <p className={styles.sidebarText}>
            Explorer остаётся честным organizer surface поверх shell-local registry.
          </p>
        </div>

        <nav className={styles.sectionList}>
          {explorerSections.map((section) => (
            <button
              key={section.id}
              className={
                section.id === currentSection ? styles.sectionButtonActive : styles.sectionButton
              }
              onClick={() => {
                openSection(section.id);
              }}
              type="button"
            >
              <strong>{section.label}</strong>
              <span>{section.description}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className={styles.content}>
        <header className={styles.contentHeader}>
          <div>
            <p className={styles.contentEyebrow}>Shell organizer</p>
            <h2 className={styles.contentTitle}>{viewModel.section.label}</h2>
            <p className={styles.contentText}>{viewModel.section.description}</p>
          </div>
          <div className={styles.headerBadges}>
            <span className={styles.headerBadge}>
              Registry entries: {registryState.entries.length}
            </span>
            <span className={styles.headerBadge}>Section: {viewModel.section.label}</span>
          </div>
        </header>

        {viewModel.entities.length > 0 && (
          <div className={styles.cardList}>
            {viewModel.entities.map((record) => (
              <article key={record.entry.id} className={styles.entityCard}>
                <div className={styles.entityLead}>
                  <span className={styles.entityAccent} aria-hidden="true">
                    {record.accent}
                  </span>
                  <div className={styles.entityBody}>
                    <h3 className={styles.entityTitle}>{record.entry.title}</h3>
                    <p className={styles.entityMeta}>
                      {record.typeLabel} · {record.stateLabel}
                    </p>
                  </div>
                </div>

                <div className={styles.entityActions}>
                  <button
                    className={styles.primaryAction}
                    onClick={() => {
                      openEntry(record.entry);
                    }}
                    type="button"
                  >
                    Открыть
                  </button>
                  {canShowDesktopEntry(record.entry) && (
                    <button
                      className={styles.secondaryAction}
                      onClick={() => {
                        showEntry(record.entry.id);
                      }}
                      type="button"
                    >
                      Показать на рабочем столе
                    </button>
                  )}
                  {canHideDesktopEntry(record.entry) && (
                    <button
                      className={styles.secondaryAction}
                      onClick={() => {
                        hideEntry(record.entry.id);
                      }}
                      type="button"
                    >
                      Скрыть с рабочего стола
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        {viewModel.buckets.length > 0 && (
          <div className={styles.bucketGrid}>
            {viewModel.buckets.map((bucket) => (
              <section key={bucket.bucket} className={styles.bucketCard}>
                <header className={styles.bucketHeader}>
                  <div>
                    <p className={styles.bucketEyebrow}>Overflow bucket</p>
                    <h3 className={styles.bucketTitle}>{bucket.title}</h3>
                  </div>
                  <span className={styles.bucketCount}>{bucket.entities.length}</span>
                </header>

                <div className={styles.bucketItems}>
                  {bucket.entities.map((record) => (
                    <article key={record.entry.id} className={styles.bucketItem}>
                      <div>
                        <strong>{record.entry.title}</strong>
                        <p>{record.typeLabel}</p>
                      </div>
                      <div className={styles.entityActions}>
                        <button
                          className={styles.primaryAction}
                          onClick={() => {
                            openEntry(record.entry);
                          }}
                          type="button"
                        >
                          Открыть
                        </button>
                        <button
                          className={styles.secondaryAction}
                          onClick={() => {
                            showEntry(record.entry.id);
                          }}
                          type="button"
                        >
                          Показать на рабочем столе
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {viewModel.appLinks.length > 0 && (
          <div className={styles.cardList}>
            {viewModel.appLinks.map((link) => (
              <article key={link.appId} className={styles.entityCard}>
                <div className={styles.entityLead}>
                  <span className={styles.entityAccent} aria-hidden="true">
                    {link.title.slice(0, 1).toUpperCase()}
                  </span>
                  <div className={styles.entityBody}>
                    <h3 className={styles.entityTitle}>{link.title}</h3>
                    <p className={styles.entityMeta}>{link.description}</p>
                  </div>
                </div>
                <div className={styles.entityActions}>
                  <button
                    className={styles.primaryAction}
                    onClick={() => {
                      openSystemApp(link.appId);
                    }}
                    type="button"
                  >
                    Открыть
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        {viewModel.entities.length === 0 &&
          viewModel.buckets.length === 0 &&
          viewModel.appLinks.length === 0 && (
            <section className={styles.emptyState}>
              <p className={styles.contentEyebrow}>Пусто</p>
              <h3 className={styles.emptyTitle}>{viewModel.emptyTitle}</h3>
              <p className={styles.emptyText}>{viewModel.emptyDescription}</p>
            </section>
          )}

        <section className={styles.integrityCard}>
          <p className={styles.contentEyebrow}>Privacy boundary</p>
          <h3 className={styles.integrityTitle}>Explorer не подменяет Search</h3>
          <p className={styles.integrityText}>
            Organizer surface только открывает canonical Search app и не делает hidden omnibox,
            server discovery или fake encrypted global search.
          </p>
          <div className={styles.integrityActions}>
            <button
              className={styles.secondaryAction}
              onClick={() => {
                openSystemApp("search");
              }}
              type="button"
            >
              Открыть Search app
            </button>
            <button
              className={styles.secondaryAction}
              onClick={() => {
                openSystemApp("friend_requests");
              }}
              type="button"
            >
              Открыть заявки
            </button>
            <button
              className={styles.secondaryAction}
              onClick={() => {
                openSystemApp("settings");
              }}
              type="button"
            >
              Открыть настройки
            </button>
          </div>
        </section>
      </section>
    </div>
  );
}

function canShowDesktopEntry(entry: DesktopEntity): boolean {
  return entry.kind !== "system_app" && (entry.visibility === "hidden" || entry.placement === "overflow");
}

function canHideDesktopEntry(entry: DesktopEntity): boolean {
  return entry.kind !== "system_app" && entry.visibility === "visible" && entry.placement === "desktop";
}
