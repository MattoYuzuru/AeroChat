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
import { subscribeEncryptedDirectMessageV2RealtimeEvents } from "../chats/encrypted-v2-realtime";
import { patchLiveEncryptedDirectChatActivity } from "../chats/live-direct-activity";
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
  hideDesktopEntity,
  listCustomFolderDesktopEntities,
  readDesktopRegistryState,
  removeCustomFolderMemberReference,
  removeGroupChatDesktopEntity,
  renameCustomFolderDesktopEntity,
  showDesktopEntityOnDesktop,
  syncDirectChatDesktopEntities,
  syncGroupChatDesktopEntities,
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
  const visibleDesktopCapacity =
    desktopShellHost?.desktopGridCapacity ?? Number.POSITIVE_INFINITY;
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
          visibleDesktopCapacity,
        )
      : null;
  const folderViewModel =
    navigationTarget.kind === "folder"
      ? buildExplorerFolderViewModel(
          registryState,
          navigationTarget.folderId,
          unreadTargetMap,
          visibleDesktopCapacity,
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
        // Legacy direct plaintext realtime payload больше не должен влиять
        // на live direct surfaces внутри Explorer/runtime.
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
        // Legacy group plaintext realtime payload больше не должен влиять
        // на live group surfaces внутри Explorer/runtime.
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
    if (desktopShellHost !== null || authenticatedState === null) {
      return;
    }

    return subscribeEncryptedDirectMessageV2RealtimeEvents((event) => {
      setLocalDirectChats((currentChats) =>
        patchLiveEncryptedDirectChatActivity(currentChats, event),
      );
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
          <h1 className={styles.sidebarTitle}>Проводник AeroChat</h1>
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
            <strong>Папки</strong>
            <span>{customFolders.length}</span>
          </div>

          {customFolders.length === 0 ? (
            <p className={styles.folderNavEmpty}>Создайте первую папку.</p>
          ) : (
            <div className={styles.folderNavList}>
              {customFolders.map((folder) => {
                const folderRecord = buildExplorerFolderViewModel(
                  registryState,
                  folder.folderId,
                  unreadTargetMap,
                  visibleDesktopCapacity,
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
              <h3 className={styles.emptyTitle}>Папка не найдена</h3>
              <p className={styles.emptyText}>Папка была удалена или ещё не создана.</p>
              <div className={styles.integrityActions}>
                <ExplorerActionButton
                  action="back"
                  onClick={() => {
                    openSection("folders");
                  }}
                  tone="secondary"
                >
                  К папкам
                </ExplorerActionButton>
              </div>
            </section>
          ) : (
            <>
              <header className={styles.contentHeader}>
                <div>
                  <p className={styles.contentEyebrow}>Папка</p>
                  <h2 className={styles.contentTitle}>{folderViewModel.folder.folder.title}</h2>
                </div>
                <div className={styles.headerBadges}>
                  <span className={styles.headerBadge}>{folderViewModel.folder.memberCount} объектов</span>
                  <span className={styles.headerBadge}>
                    Непрочитано {folderViewModel.folder.unreadCount}
                  </span>
                </div>
              </header>

              <section className={styles.toolbarCard}>
                <div className={styles.entityActions}>
                  <ExplorerActionButton
                    action="rename"
                    onClick={() => {
                      startRenamingFolder(folderViewModel.folder);
                    }}
                    tone="primary"
                  >
                    Переименовать
                  </ExplorerActionButton>
                  <ExplorerActionButton
                    action="delete"
                    onClick={() => {
                      handleDeleteFolder(folderViewModel.folder.folder.folderId);
                    }}
                    tone="secondary"
                  >
                    Удалить папку
                  </ExplorerActionButton>
                  {canShowDesktopEntry(folderViewModel.folder.folder) && (
                    <ExplorerActionButton
                      action="show"
                      onClick={() => {
                        showEntry(folderViewModel.folder.folder.id);
                      }}
                      tone="secondary"
                    >
                      Показать на рабочем столе
                    </ExplorerActionButton>
                  )}
                  {canHideDesktopEntry(folderViewModel.folder.folder) && (
                    <ExplorerActionButton
                      action="hide"
                      onClick={() => {
                        hideEntry(folderViewModel.folder.folder.id);
                      }}
                      tone="secondary"
                    >
                      Скрыть с рабочего стола
                    </ExplorerActionButton>
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
                    <ExplorerActionButton
                      action="save"
                      onClick={() => {
                        handleRenameFolder(folderViewModel.folder.folder.folderId);
                      }}
                      tone="primary"
                    >
                      Сохранить
                    </ExplorerActionButton>
                    <ExplorerActionButton
                      action="cancel"
                      onClick={cancelRenamingFolder}
                      tone="secondary"
                    >
                      Отмена
                    </ExplorerActionButton>
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
                        <ExplorerActionButton
                          action="open"
                          onClick={() => {
                            openEntry(record.entry);
                          }}
                          tone="primary"
                        >
                          Открыть
                        </ExplorerActionButton>
                        <ExplorerActionButton
                          action="remove"
                          onClick={() => {
                            handleRemoveFolderMember(record.referenceId);
                          }}
                          tone="secondary"
                        >
                          Убрать из папки
                        </ExplorerActionButton>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <section className={styles.emptyState}>
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
                <h2 className={styles.contentTitle}>{sectionViewModel?.section.label}</h2>
                <p className={styles.contentText}>{sectionViewModel?.section.description}</p>
              </div>
              <div className={styles.headerBadges}>
                <span className={styles.headerBadge}>
                  {(sectionViewModel?.entities.length ?? 0) +
                    (sectionViewModel?.folders.length ?? 0) +
                    (sectionViewModel?.buckets.reduce(
                      (count, bucket) => count + bucket.entities.length,
                      0,
                    ) ?? 0)}
                  {" "}объектов
                </span>
              </div>
            </header>

            {sectionViewModel?.section.id === "folders" && (
              <section className={styles.toolbarCard}>
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
                  <ExplorerActionButton
                    action="create"
                    onClick={handleCreateFolder}
                    tone="primary"
                  >
                    Создать папку
                  </ExplorerActionButton>
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
                      <ExplorerActionButton
                        action="open"
                        onClick={() => {
                          openFolder(folder.folder.folderId);
                        }}
                        tone="primary"
                      >
                        Открыть
                      </ExplorerActionButton>
                      <ExplorerActionButton
                        action="rename"
                        onClick={() => {
                          startRenamingFolder(folder);
                        }}
                        tone="secondary"
                      >
                        Переименовать
                      </ExplorerActionButton>
                      <ExplorerActionButton
                        action="delete"
                        onClick={() => {
                          handleDeleteFolder(folder.folder.folderId);
                        }}
                        tone="secondary"
                      >
                        Удалить
                      </ExplorerActionButton>
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
                  <ExplorerActionButton
                    action="save"
                    onClick={() => {
                      handleRenameFolder(renamingFolderId);
                    }}
                    tone="primary"
                  >
                    Сохранить
                  </ExplorerActionButton>
                  <ExplorerActionButton
                    action="cancel"
                    onClick={cancelRenamingFolder}
                    tone="secondary"
                  >
                    Отмена
                  </ExplorerActionButton>
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
                      <ExplorerActionButton
                        action="open"
                        onClick={() => {
                          openEntry(record.entry);
                        }}
                        tone="primary"
                      >
                        Открыть
                      </ExplorerActionButton>
                      {canShowDesktopEntry(record.entry) && (
                        <ExplorerActionButton
                          action="show"
                          onClick={() => {
                            showEntry(record.entry.id);
                          }}
                          tone="secondary"
                        >
                          Показать на рабочем столе
                        </ExplorerActionButton>
                      )}
                      {canHideDesktopEntry(record.entry) && (
                        <ExplorerActionButton
                          action="hide"
                          onClick={() => {
                            hideEntry(record.entry.id);
                          }}
                          tone="secondary"
                        >
                          Скрыть с рабочего стола
                        </ExplorerActionButton>
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
                          <ExplorerActionButton
                            action="add"
                            onClick={() => {
                              handleAddEntryToFolder(record.entry);
                            }}
                            tone="secondary"
                          >
                            Добавить в папку
                          </ExplorerActionButton>
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
                            <ExplorerActionButton
                              action="open"
                              onClick={() => {
                                openEntry(record.entry);
                              }}
                              tone="primary"
                            >
                              Открыть
                            </ExplorerActionButton>
                            <ExplorerActionButton
                              action="show"
                              onClick={() => {
                                showEntry(record.entry.id);
                              }}
                              tone="secondary"
                            >
                              Показать на рабочем столе
                            </ExplorerActionButton>
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
                      <ExplorerActionButton
                        action="open"
                        onClick={() => {
                          openSystemApp(link.appId);
                        }}
                        tone="primary"
                      >
                        Открыть
                      </ExplorerActionButton>
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
                  <h3 className={styles.emptyTitle}>{sectionViewModel.emptyTitle}</h3>
                  <p className={styles.emptyText}>{sectionViewModel.emptyDescription}</p>
                </section>
              )}
          </>
        )}
      </section>
    </div>
  );
}

function ExplorerActionButton({
  action,
  children,
  onClick,
  tone,
}: {
  action:
    | "add"
    | "back"
    | "cancel"
    | "create"
    | "delete"
    | "hide"
    | "open"
    | "remove"
    | "rename"
    | "save"
    | "show";
  children: string;
  onClick(): void;
  tone: "primary" | "secondary";
}) {
  return (
    <button
      className={tone === "primary" ? styles.primaryAction : styles.secondaryAction}
      data-action={action}
      onClick={onClick}
      title={children}
      type="button"
    >
      <span aria-hidden="true" className={styles.actionGlyph} data-action={action} />
      <span className={styles.actionLabel}>{children}</span>
    </button>
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
