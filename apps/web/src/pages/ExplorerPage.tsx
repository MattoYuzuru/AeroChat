import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import {
  buildDirectChatRoutePath,
  buildExplorerFolderRoutePath,
  buildExplorerRoutePath,
  buildGroupChatRoutePath,
  buildSelfChatRoutePath,
} from "../app/app-routes";
import { parseDirectChatRealtimeEvent } from "../chats/realtime";
import { gatewayClient } from "../gateway/runtime";
import type { DirectChat, Group } from "../gateway/types";
import { parseGroupRealtimeEvent } from "../groups/realtime";
import { subscribeRealtimeEnvelopes } from "../realtime/events";
import {
  buildExplorerFolderViewModel,
  buildExplorerSectionViewModel,
  explorerSections,
  resolveExplorerNavigationTarget,
  type ExplorerEntityRecord,
  type ExplorerFolderRecord,
  type ExplorerSectionId,
} from "../shell/explorer-model";
import { useDesktopShellHost } from "../shell/context";
import {
  addCustomFolderMemberReference,
  createCustomFolderDesktopEntity,
  createDesktopUnreadTargetMap,
  deleteCustomFolderDesktopEntity,
  describeDirectChatDesktopTitle,
  hideDesktopEntity,
  listCustomFolderDesktopEntities,
  readDesktopRegistryState,
  removeCustomFolderMemberReference,
  removeGroupChatDesktopEntity,
  renameCustomFolderDesktopEntity,
  showDesktopEntityOnDesktop,
  syncDirectChatDesktopEntities,
  syncGroupChatDesktopEntities,
  upsertDirectChatDesktopEntity,
  upsertGroupChatDesktopEntity,
  writeDesktopRegistryState,
  type DesktopEntity,
  type DesktopFolderReferenceTarget,
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
  const [localDirectChats, setLocalDirectChats] = useState<DirectChat[]>([]);
  const [localGroups, setLocalGroups] = useState<Group[]>([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renamingFolderName, setRenamingFolderName] = useState("");
  const [folderSelectionByEntryId, setFolderSelectionByEntryId] = useState<
    Record<string, string>
  >({});

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const navigationTarget = resolveExplorerNavigationTarget({
    section: searchParams.get("section"),
    folder: searchParams.get("folder"),
  });
  const registryState = desktopShellHost?.desktopRegistryState ?? localRegistryState;
  const unreadTargetMap =
    desktopShellHost?.desktopUnreadTargetMap ??
    createDesktopUnreadTargetMap(localDirectChats, localGroups);
  const sectionViewModel =
    navigationTarget.kind === "section"
      ? buildExplorerSectionViewModel(
          registryState,
          navigationTarget.sectionId,
          unreadTargetMap,
        )
      : null;
  const folderViewModel =
    navigationTarget.kind === "folder"
      ? buildExplorerFolderViewModel(
          registryState,
          navigationTarget.folderId,
          unreadTargetMap,
        )
      : null;
  const customFolders = listCustomFolderDesktopEntities(registryState);
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

        setLocalDirectChats(directChats);
        setLocalGroups(groups);
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
    if (desktopShellHost !== null || authenticatedState === null) {
      return;
    }

    return subscribeRealtimeEnvelopes((envelope) => {
      const directEvent = parseDirectChatRealtimeEvent(envelope);
      if (directEvent?.type === "direct_chat.message.updated") {
        setLocalDirectChats((currentChats) => upsertLiveDirectChat(currentChats, directEvent.chat));
        setLocalRegistryState((currentState) =>
          upsertDirectChatDesktopEntity(
            currentState,
            directEvent.chat.id,
            describeDirectChatDesktopTitle(directEvent.chat, authenticatedState.profile.id),
          ),
        );
        return;
      }

      if (directEvent?.type === "direct_chat.read.updated") {
        setLocalDirectChats((currentChats) =>
          patchLiveDirectChatUnread(
            currentChats,
            directEvent.chatId,
            directEvent.unreadCount,
            directEvent.encryptedUnreadCount,
          ),
        );
        return;
      }

      const groupEvent = parseGroupRealtimeEvent(envelope);
      if (groupEvent === null) {
        return;
      }

      if (groupEvent.type === "group.message.updated") {
        setLocalGroups((currentGroups) => upsertLiveGroup(currentGroups, groupEvent.group));
        setLocalRegistryState((currentState) =>
          upsertGroupChatDesktopEntity(
            currentState,
            groupEvent.group.id,
            groupEvent.group.name,
          ),
        );
        return;
      }

      if (groupEvent.type === "group.read.updated") {
        setLocalGroups((currentGroups) =>
          patchLiveGroupUnread(
            currentGroups,
            groupEvent.groupId,
            groupEvent.unreadCount,
            groupEvent.encryptedUnreadCount,
          ),
        );
        return;
      }

      if (groupEvent.type === "group.membership.updated") {
        if (groupEvent.group === null || groupEvent.selfMember === null) {
          setLocalGroups((currentGroups) =>
            currentGroups.filter((group) => group.id !== groupEvent.groupId),
          );
          setLocalRegistryState((currentState) =>
            removeGroupChatDesktopEntity(currentState, groupEvent.groupId),
          );
          return;
        }

        const nextGroup = groupEvent.group;
        setLocalGroups((currentGroups) => upsertLiveGroup(currentGroups, nextGroup));
        setLocalRegistryState((currentState) =>
          upsertGroupChatDesktopEntity(
            currentState,
            nextGroup.id,
            nextGroup.name,
          ),
        );
        return;
      }

      if (
        (groupEvent.type === "group.role.updated" ||
          groupEvent.type === "group.ownership.transferred" ||
          groupEvent.type === "group.moderation.updated") &&
        groupEvent.group !== null
      ) {
        const nextGroup = groupEvent.group;
        setLocalGroups((currentGroups) => upsertLiveGroup(currentGroups, nextGroup));
        setLocalRegistryState((currentState) =>
          upsertGroupChatDesktopEntity(
            currentState,
            nextGroup.id,
            nextGroup.name,
          ),
        );
      }
    });
  }, [authenticatedState, desktopShellHost]);

  useEffect(() => {
    if (desktopShellHost !== null) {
      return;
    }

    writeDesktopRegistryState(storage, localRegistryState);
  }, [desktopShellHost, localRegistryState, storage]);

  useEffect(() => {
    if (desktopShellHost === null) {
      return;
    }

    if (navigationTarget.kind === "folder") {
      const folderTitle = folderViewModel?.folder.folder.title ?? "Explorer";
      desktopShellHost.syncCurrentRouteTitle(`Explorer · ${folderTitle}`);
      return;
    }

    const currentSection =
      sectionViewModel?.section.label === "Рабочий стол"
        ? "Explorer"
        : `Explorer · ${sectionViewModel?.section.label ?? "Explorer"}`;
    desktopShellHost.syncCurrentRouteTitle(currentSection);
  }, [desktopShellHost, folderViewModel, navigationTarget, sectionViewModel]);

  function openSection(sectionId: ExplorerSectionId) {
    const nextSearchParams = new URLSearchParams();
    if (sectionId !== "desktop") {
      nextSearchParams.set("section", sectionId);
    }

    navigate(buildExplorerRoutePath(nextSearchParams));
  }

  function openFolder(folderId: string) {
    if (desktopShellHost !== null) {
      desktopShellHost.openCustomFolder(folderId);
      return;
    }

    navigate(buildExplorerFolderRoutePath(folderId));
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

    if (entry.kind === "custom_folder") {
      openFolder(entry.folderId);
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

  function handleCreateFolder() {
    const normalizedName = newFolderName.trim();
    if (normalizedName === "") {
      return;
    }

    if (desktopShellHost !== null) {
      const folderId = desktopShellHost.createCustomFolder(normalizedName);
      setNewFolderName("");
      openFolder(folderId);
      return;
    }

    const nextFolderId = `folder-${registryState.nextFolderSequence}`;
    setLocalRegistryState((currentState) =>
      createCustomFolderDesktopEntity(currentState, normalizedName),
    );
    setNewFolderName("");
    navigate(buildExplorerFolderRoutePath(nextFolderId));
  }

  function startRenamingFolder(folder: ExplorerFolderRecord) {
    setRenamingFolderId(folder.folder.folderId);
    setRenamingFolderName(folder.folder.title);
  }

  function cancelRenamingFolder() {
    setRenamingFolderId(null);
    setRenamingFolderName("");
  }

  function handleRenameFolder(folderId: string) {
    const normalizedName = renamingFolderName.trim();
    if (normalizedName === "") {
      return;
    }

    if (desktopShellHost !== null) {
      desktopShellHost.renameCustomFolder(folderId, normalizedName);
    } else {
      setLocalRegistryState((currentState) =>
        renameCustomFolderDesktopEntity(currentState, folderId, normalizedName),
      );
    }

    cancelRenamingFolder();
  }

  function handleDeleteFolder(folderId: string) {
    const confirmed = window.confirm(
      "Удалить папку? Будут удалены только shell-local ссылки, а не underlying chats или groups.",
    );
    if (!confirmed) {
      return;
    }

    if (desktopShellHost !== null) {
      desktopShellHost.deleteCustomFolder(folderId);
    } else {
      setLocalRegistryState((currentState) =>
        deleteCustomFolderDesktopEntity(currentState, folderId),
      );
    }

    if (navigationTarget.kind === "folder" && navigationTarget.folderId === folderId) {
      openSection("folders");
    }
  }

  function handleAddEntryToFolder(entry: DesktopEntity) {
    if (entry.kind !== "direct_chat" && entry.kind !== "group_chat") {
      return;
    }

    const selectedFolderId =
      folderSelectionByEntryId[entry.id] ?? customFolders[0]?.folderId ?? null;
    if (selectedFolderId === null) {
      return;
    }

    const target: DesktopFolderReferenceTarget = {
      kind: entry.kind,
      targetKey: entry.targetKey,
    };

    if (desktopShellHost !== null) {
      desktopShellHost.addFolderMember(selectedFolderId, target);
      return;
    }

    setLocalRegistryState((currentState) =>
      addCustomFolderMemberReference(currentState, selectedFolderId, target),
    );
  }

  function handleRemoveFolderMember(referenceId: string) {
    if (desktopShellHost !== null) {
      desktopShellHost.removeFolderMember(referenceId);
      return;
    }

    setLocalRegistryState((currentState) =>
      removeCustomFolderMemberReference(currentState, referenceId),
    );
  }

  return (
    <div className={styles.surface}>
      <aside className={styles.sidebar} aria-label="Explorer navigation">
        <div className={styles.sidebarHeader}>
          <p className={styles.sidebarEyebrow}>Explorer</p>
          <h1 className={styles.sidebarTitle}>Организация shell entrypoints</h1>
          <p className={styles.sidebarText}>
            Explorer остаётся честным organizer surface поверх shell-local registry и custom folders.
          </p>
        </div>

        <nav className={styles.sectionList}>
          {explorerSections.map((section) => {
            const isActive =
              navigationTarget.kind === "section" && navigationTarget.sectionId === section.id;

            return (
              <button
                key={section.id}
                className={isActive ? styles.sectionButtonActive : styles.sectionButton}
                onClick={() => {
                  openSection(section.id);
                }}
                type="button"
              >
                <strong>{section.label}</strong>
                <span>{section.description}</span>
              </button>
            );
          })}
        </nav>

        <section className={styles.folderNav}>
          <div className={styles.folderNavHeader}>
            <strong>Custom folders</strong>
            <span>{customFolders.length}</span>
          </div>

          {customFolders.length === 0 ? (
            <p className={styles.folderNavEmpty}>
              Создайте первую shell-local папку в секции «Папки».
            </p>
          ) : (
            <div className={styles.folderNavList}>
              {customFolders.map((folder) => {
                const folderRecord = buildExplorerFolderViewModel(
                  registryState,
                  folder.folderId,
                  unreadTargetMap,
                )?.folder;

                return (
                  <button
                    key={folder.folderId}
                    className={
                      navigationTarget.kind === "folder" &&
                      navigationTarget.folderId === folder.folderId
                        ? styles.folderNavButtonActive
                        : styles.folderNavButton
                    }
                    onClick={() => {
                      openFolder(folder.folderId);
                    }}
                    type="button"
                  >
                    <span>{folder.title}</span>
                    <small>
                      {folderRecord?.memberCount ?? 0} объектов · непрочитано{" "}
                      {folderRecord?.unreadCount ?? 0}
                    </small>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </aside>

      <section className={styles.content}>
        {navigationTarget.kind === "folder" ? (
          folderViewModel === null ? (
            <section className={styles.emptyState}>
              <p className={styles.contentEyebrow}>Folder target</p>
              <h3 className={styles.emptyTitle}>Папка не найдена</h3>
              <p className={styles.emptyText}>
                Этот shell-local folder target больше не существует или был удалён.
              </p>
              <div className={styles.integrityActions}>
                <button
                  className={styles.secondaryAction}
                  onClick={() => {
                    openSection("folders");
                  }}
                  type="button"
                >
                  Вернуться к папкам
                </button>
              </div>
            </section>
          ) : (
            <>
              <header className={styles.contentHeader}>
                <div>
                  <p className={styles.contentEyebrow}>Custom folder</p>
                  <h2 className={styles.contentTitle}>{folderViewModel.folder.folder.title}</h2>
                  <p className={styles.contentText}>
                    Папка хранит только shell-local shortcut-ссылки на canonical chats и groups.
                  </p>
                </div>
                <div className={styles.headerBadges}>
                  <span className={styles.headerBadge}>
                    Объекты: {folderViewModel.folder.memberCount}
                  </span>
                  <span className={styles.headerBadge}>
                    Непрочитано: {folderViewModel.folder.unreadCount}
                  </span>
                  <span className={styles.headerBadge}>
                    {folderViewModel.folder.stateLabel}
                  </span>
                </div>
              </header>

              <section className={styles.toolbarCard}>
                <div className={styles.entityActions}>
                  <button
                    className={styles.primaryAction}
                    onClick={() => {
                      startRenamingFolder(folderViewModel.folder);
                    }}
                    type="button"
                  >
                    Переименовать
                  </button>
                  <button
                    className={styles.secondaryAction}
                    onClick={() => {
                      handleDeleteFolder(folderViewModel.folder.folder.folderId);
                    }}
                    type="button"
                  >
                    Удалить папку
                  </button>
                  {canShowDesktopEntry(folderViewModel.folder.folder) && (
                    <button
                      className={styles.secondaryAction}
                      onClick={() => {
                        showEntry(folderViewModel.folder.folder.id);
                      }}
                      type="button"
                    >
                      Показать на рабочем столе
                    </button>
                  )}
                  {canHideDesktopEntry(folderViewModel.folder.folder) && (
                    <button
                      className={styles.secondaryAction}
                      onClick={() => {
                        hideEntry(folderViewModel.folder.folder.id);
                      }}
                      type="button"
                    >
                      Скрыть с рабочего стола
                    </button>
                  )}
                </div>

                {renamingFolderId === folderViewModel.folder.folder.folderId && (
                  <div className={styles.inlineForm}>
                    <input
                      className={styles.textInput}
                      onChange={(event) => {
                        setRenamingFolderName(event.target.value);
                      }}
                      placeholder="Название папки"
                      type="text"
                      value={renamingFolderName}
                    />
                    <button
                      className={styles.primaryAction}
                      onClick={() => {
                        handleRenameFolder(folderViewModel.folder.folder.folderId);
                      }}
                      type="button"
                    >
                      Сохранить
                    </button>
                    <button
                      className={styles.secondaryAction}
                      onClick={cancelRenamingFolder}
                      type="button"
                    >
                      Отмена
                    </button>
                  </div>
                )}
              </section>

              {folderViewModel.members.length > 0 ? (
                <div className={styles.cardList}>
                  {folderViewModel.members.map((record) => (
                    <article key={record.referenceId} className={styles.entityCard}>
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
                        {record.hasUnread && (
                          <span className={styles.inlineBadge}>Непрочитано</span>
                        )}
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
                            handleRemoveFolderMember(record.referenceId);
                          }}
                          type="button"
                        >
                          Убрать из папки
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <section className={styles.emptyState}>
                  <p className={styles.contentEyebrow}>Пусто</p>
                  <h3 className={styles.emptyTitle}>{folderViewModel.emptyTitle}</h3>
                  <p className={styles.emptyText}>{folderViewModel.emptyDescription}</p>
                </section>
              )}
            </>
          )
        ) : (
          <>
            <header className={styles.contentHeader}>
              <div>
                <p className={styles.contentEyebrow}>Shell organizer</p>
                <h2 className={styles.contentTitle}>{sectionViewModel?.section.label}</h2>
                <p className={styles.contentText}>{sectionViewModel?.section.description}</p>
              </div>
              <div className={styles.headerBadges}>
                <span className={styles.headerBadge}>
                  Registry entries: {registryState.entries.length}
                </span>
                <span className={styles.headerBadge}>Folders: {customFolders.length}</span>
                <span className={styles.headerBadge}>
                  Section: {sectionViewModel?.section.label}
                </span>
              </div>
            </header>

            {sectionViewModel?.section.id === "folders" && (
              <section className={styles.toolbarCard}>
                <p className={styles.contentText}>
                  В этой версии custom folders остаются browser-local organizer objects без server sync и без nested hierarchy.
                </p>
                <div className={styles.inlineForm}>
                  <input
                    className={styles.textInput}
                    onChange={(event) => {
                      setNewFolderName(event.target.value);
                    }}
                    placeholder="Новая папка"
                    type="text"
                    value={newFolderName}
                  />
                  <button
                    className={styles.primaryAction}
                    onClick={handleCreateFolder}
                    type="button"
                  >
                    Создать папку
                  </button>
                </div>
              </section>
            )}

            {sectionViewModel && sectionViewModel.folders.length > 0 && (
              <div className={styles.cardList}>
                {sectionViewModel.folders.map((folder) => (
                  <article key={folder.folder.folderId} className={styles.entityCard}>
                    <div className={styles.entityLead}>
                      <span className={styles.entityAccent} aria-hidden="true">
                        {folder.accent}
                      </span>
                      <div className={styles.entityBody}>
                        <h3 className={styles.entityTitle}>{folder.folder.title}</h3>
                        <p className={styles.entityMeta}>
                          {folder.stateLabel} · {folder.memberCount} объектов
                        </p>
                      </div>
                    </div>

                    <div className={styles.entityActions}>
                      {folder.unreadCount > 0 && (
                        <span className={styles.inlineBadge}>
                          Непрочитано {folder.unreadCount}
                        </span>
                      )}
                      <button
                        className={styles.primaryAction}
                        onClick={() => {
                          openFolder(folder.folder.folderId);
                        }}
                        type="button"
                      >
                        Открыть
                      </button>
                      <button
                        className={styles.secondaryAction}
                        onClick={() => {
                          startRenamingFolder(folder);
                        }}
                        type="button"
                      >
                        Переименовать
                      </button>
                      <button
                        className={styles.secondaryAction}
                        onClick={() => {
                          handleDeleteFolder(folder.folder.folderId);
                        }}
                        type="button"
                      >
                        Удалить
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {sectionViewModel && renamingFolderId !== null && (
              <section className={styles.toolbarCard}>
                <div className={styles.inlineForm}>
                  <input
                    className={styles.textInput}
                    onChange={(event) => {
                      setRenamingFolderName(event.target.value);
                    }}
                    placeholder="Название папки"
                    type="text"
                    value={renamingFolderName}
                  />
                  <button
                    className={styles.primaryAction}
                    onClick={() => {
                      handleRenameFolder(renamingFolderId);
                    }}
                    type="button"
                  >
                    Сохранить
                  </button>
                  <button
                    className={styles.secondaryAction}
                    onClick={cancelRenamingFolder}
                    type="button"
                  >
                    Отмена
                  </button>
                </div>
              </section>
            )}

            {sectionViewModel && sectionViewModel.entities.length > 0 && (
              <div className={styles.cardList}>
                {sectionViewModel.entities.map((record) => (
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
                        {record.supplementalLabel && (
                          <p className={styles.entityMeta}>{record.supplementalLabel}</p>
                        )}
                      </div>
                    </div>

                    <div className={styles.entityActions}>
                      {record.unreadCount > 0 && (
                        <span className={styles.inlineBadge}>
                          Непрочитано {record.unreadCount}
                        </span>
                      )}
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
                      {canAddEntryToFolder(record, customFolders) && (
                        <>
                          <select
                            className={styles.selectInput}
                            onChange={(event) => {
                              setFolderSelectionByEntryId((currentState) => ({
                                ...currentState,
                                [record.entry.id]: event.target.value,
                              }));
                            }}
                            value={
                              folderSelectionByEntryId[record.entry.id] ??
                              customFolders[0]?.folderId ??
                              ""
                            }
                          >
                            {customFolders.map((folder) => (
                              <option key={folder.folderId} value={folder.folderId}>
                                {folder.title}
                              </option>
                            ))}
                          </select>
                          <button
                            className={styles.secondaryAction}
                            onClick={() => {
                              handleAddEntryToFolder(record.entry);
                            }}
                            type="button"
                          >
                            Добавить в папку
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}

            {sectionViewModel && sectionViewModel.buckets.length > 0 && (
              <div className={styles.bucketGrid}>
                {sectionViewModel.buckets.map((bucket) => (
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
                            {record.unreadCount > 0 && (
                              <span className={styles.inlineBadge}>
                                Непрочитано {record.unreadCount}
                              </span>
                            )}
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

            {sectionViewModel && sectionViewModel.appLinks.length > 0 && (
              <div className={styles.cardList}>
                {sectionViewModel.appLinks.map((link) => (
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

            {sectionViewModel &&
              sectionViewModel.entities.length === 0 &&
              sectionViewModel.folders.length === 0 &&
              sectionViewModel.buckets.length === 0 &&
              sectionViewModel.appLinks.length === 0 && (
                <section className={styles.emptyState}>
                  <p className={styles.contentEyebrow}>Пусто</p>
                  <h3 className={styles.emptyTitle}>{sectionViewModel.emptyTitle}</h3>
                  <p className={styles.emptyText}>{sectionViewModel.emptyDescription}</p>
                </section>
              )}
          </>
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
  return (
    entry.kind !== "system_app" &&
    (entry.visibility === "hidden" || entry.placement === "overflow")
  );
}

function canHideDesktopEntry(entry: DesktopEntity): boolean {
  return (
    entry.kind !== "system_app" &&
    entry.visibility === "visible" &&
    entry.placement === "desktop"
  );
}

function canAddEntryToFolder(
  record: ExplorerEntityRecord,
  folders: Array<{ folderId: string }>,
): boolean {
  return (
    folders.length > 0 &&
    (record.entry.kind === "direct_chat" || record.entry.kind === "group_chat")
  );
}

function upsertLiveDirectChat(
  chats: DirectChat[],
  nextChat: DirectChat,
): DirectChat[] {
  return upsertLiveTargetById(chats, nextChat);
}

function patchLiveDirectChatUnread(
  chats: DirectChat[],
  chatId: string,
  unreadCount: number | null,
  encryptedUnreadCount: number | null,
): DirectChat[] {
  return chats.map((chat) =>
    chat.id !== chatId
      ? chat
      : {
          ...chat,
          unreadCount: unreadCount ?? chat.unreadCount,
          encryptedUnreadCount: encryptedUnreadCount ?? chat.encryptedUnreadCount,
        },
  );
}

function upsertLiveGroup(groups: Group[], nextGroup: Group): Group[] {
  return upsertLiveTargetById(groups, nextGroup);
}

function patchLiveGroupUnread(
  groups: Group[],
  groupId: string,
  unreadCount: number,
  encryptedUnreadCount: number | null,
): Group[] {
  return groups.map((group) =>
    group.id !== groupId
      ? group
      : {
          ...group,
          unreadCount,
          encryptedUnreadCount:
            encryptedUnreadCount === null
              ? group.encryptedUnreadCount
              : encryptedUnreadCount,
        },
  );
}

function upsertLiveTargetById<T extends { id: string }>(
  items: T[],
  nextItem: T,
): T[] {
  const existingIndex = items.findIndex((item) => item.id === nextItem.id);
  if (existingIndex === -1) {
    return [...items, nextItem];
  }

  return items.map((item) => (item.id === nextItem.id ? nextItem : item));
}
