import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { SafeMessageMarkdown } from "../chats/SafeMessageMarkdown";
import { gatewayClient } from "../gateway/runtime";
import {
  describeGatewayError,
  isGatewayErrorCode,
  type CreatedGroupInviteLink,
  type Group,
  type GroupChatSnapshot,
  type GroupInviteLink,
  type GroupMember,
  type GroupMemberRole,
  type GroupMessage,
} from "../gateway/types";
import { buildGroupInviteUrl, extractGroupInviteToken } from "../groups/invite-token";
import styles from "./GroupsPage.module.css";

type SelectedState =
  | {
      status: "idle";
      snapshot: null;
      members: GroupMember[];
      inviteLinks: GroupInviteLink[];
      messages: GroupMessage[];
      errorMessage: null;
    }
  | {
      status: "loading";
      snapshot: null;
      members: GroupMember[];
      inviteLinks: GroupInviteLink[];
      messages: GroupMessage[];
      errorMessage: null;
    }
  | {
      status: "ready";
      snapshot: GroupChatSnapshot;
      members: GroupMember[];
      inviteLinks: GroupInviteLink[];
      messages: GroupMessage[];
      errorMessage: null;
    }
  | {
      status: "error";
      snapshot: null;
      members: GroupMember[];
      inviteLinks: GroupInviteLink[];
      messages: GroupMessage[];
      errorMessage: string;
    };

const initialSelectedState: SelectedState = {
  status: "idle",
  snapshot: null,
  members: [],
  inviteLinks: [],
  messages: [],
  errorMessage: null,
};

export function GroupsPage() {
  const { state: authState, expireSession } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsStatus, setGroupsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [selectedState, setSelectedState] = useState<SelectedState>(initialSelectedState);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [joinInput, setJoinInput] = useState("");
  const [composerText, setComposerText] = useState("");
  const [inviteRole, setInviteRole] = useState<GroupMemberRole>("member");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isCreatingInviteLink, setIsCreatingInviteLink] = useState(false);
  const [pendingDisableInviteId, setPendingDisableInviteId] = useState<string | null>(null);
  const [pendingRoleUserId, setPendingRoleUserId] = useState<string | null>(null);
  const [pendingRemoveUserId, setPendingRemoveUserId] = useState<string | null>(null);
  const [pendingTransferUserId, setPendingTransferUserId] = useState<string | null>(null);
  const [isLeavingGroup, setIsLeavingGroup] = useState(false);
  const [memberRoleDrafts, setMemberRoleDrafts] = useState<Record<string, GroupMemberRole>>({});
  const [lastCreatedInvite, setLastCreatedInvite] = useState<CreatedGroupInviteLink | null>(null);

  const selectedGroupId = searchParams.get("group")?.trim() ?? "";
  const joinTokenFromRoute = searchParams.get("join")?.trim() ?? "";
  const token = authState.status === "authenticated" ? authState.token : "";

  useEffect(() => {
    if (joinTokenFromRoute !== "") {
      setJoinInput(joinTokenFromRoute);
    }
  }, [joinTokenFromRoute]);

  useEffect(() => {
    if (authState.status !== "authenticated") {
      return;
    }

    let active = true;
    setGroupsStatus("loading");
    setGroupsError(null);

    void (async () => {
      try {
        const nextGroups = await gatewayClient.listGroups(token);
        if (!active) {
          return;
        }

        setGroups(nextGroups);
        setGroupsStatus("ready");
      } catch (error) {
        const message = resolveProtectedError(
          error,
          "Не удалось загрузить список групп через gateway.",
          expireSession,
        );
        if (!active || message === null) {
          return;
        }

        setGroups([]);
        setGroupsStatus("error");
        setGroupsError(message);
      }
    })();

    return () => {
      active = false;
    };
  }, [authState.status, token, expireSession]);

  useEffect(() => {
    if (authState.status !== "authenticated") {
      return;
    }
    if (selectedGroupId === "") {
      setSelectedState(initialSelectedState);
      setComposerText("");
      setMemberRoleDrafts({});
      return;
    }

    let active = true;
    setSelectedState({
      status: "loading",
      snapshot: null,
      members: [],
      inviteLinks: [],
      messages: [],
      errorMessage: null,
    });

    void (async () => {
      try {
        const snapshot = await gatewayClient.getGroupChat(token, selectedGroupId);
        const membersPromise = gatewayClient.listGroupMembers(token, selectedGroupId);
        const messagesPromise = gatewayClient.listGroupMessages(token, selectedGroupId);
        const inviteLinksPromise = canManageInviteLinks(snapshot.group.selfRole)
          ? gatewayClient.listGroupInviteLinks(token, selectedGroupId)
          : Promise.resolve([]);
        const [members, messages, inviteLinks] = await Promise.all([
          membersPromise,
          messagesPromise,
          inviteLinksPromise,
        ]);
        if (!active) {
          return;
        }

        setSelectedState({
          status: "ready",
          snapshot,
          members,
          inviteLinks,
          messages,
          errorMessage: null,
        });
        setMemberRoleDrafts(buildMemberRoleDrafts(members));
      } catch (error) {
        const message = resolveProtectedError(
          error,
          "Не удалось открыть group chat через gateway.",
          expireSession,
        );
        if (!active || message === null) {
          return;
        }

        setSelectedState({
          status: "error",
          snapshot: null,
          members: [],
          inviteLinks: [],
          messages: [],
          errorMessage: message,
        });
        setMemberRoleDrafts({});
      }
    })();

    return () => {
      active = false;
    };
  }, [authState.status, expireSession, selectedGroupId, token]);

  if (authState.status !== "authenticated") {
    return null;
  }

  const activeInviteCount =
    selectedState.status === "ready"
      ? selectedState.inviteLinks.filter((inviteLink) => inviteLink.disabledAt === null).length
      : 0;
  const requestedJoinToken = extractGroupInviteToken(joinInput || joinTokenFromRoute);
  const threadMessages =
    selectedState.status === "ready" ? [...selectedState.messages].reverse() : [];
  const canManageMembership =
    selectedState.status === "ready" &&
    selectedState.snapshot.group.selfRole === "owner";

  async function reloadGroups() {
    if (groupsStatus === "loading") {
      return;
    }

    setIsRefreshing(true);
    setActionError(null);

    try {
      const nextGroups = await gatewayClient.listGroups(token);
      setGroups(nextGroups);
      setGroupsStatus("ready");
      setGroupsError(null);
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось обновить список групп.",
        expireSession,
      );
      if (message !== null) {
        setGroupsStatus("error");
        setGroupsError(message);
      }
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = groupName.trim();
    if (normalizedName === "") {
      setActionError("Введите имя группы, прежде чем создавать её.");
      setNotice(null);
      return;
    }

    setIsCreatingGroup(true);
    setActionError(null);
    setNotice(null);

    try {
      const group = await gatewayClient.createGroup(token, normalizedName);
      setGroupName("");
      setComposerText("");
      setLastCreatedInvite(null);
      setNotice("Группа создана.");
      await reloadGroups();
      openGroup(group.id);
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось создать группу.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setIsCreatingGroup(false);
    }
  }

  async function handleJoinByInviteLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestedJoinToken === "") {
      setActionError("Вставьте invite link или raw invite token.");
      setNotice(null);
      return;
    }

    setIsJoining(true);
    setActionError(null);
    setNotice(null);

    try {
      const group = await gatewayClient.joinGroupByInviteLink(token, requestedJoinToken);
      setJoinInput(requestedJoinToken);
      setComposerText("");
      setLastCreatedInvite(null);
      setNotice("Вход в группу выполнен.");
      await reloadGroups();
      openGroup(group.id);
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось присоединиться к группе по invite link.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setIsJoining(false);
    }
  }

  async function handleCreateInviteLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedState.status !== "ready") {
      return;
    }

    setIsCreatingInviteLink(true);
    setActionError(null);
    setNotice(null);

    try {
      const createdInviteLink = await gatewayClient.createGroupInviteLink(
        token,
        selectedState.snapshot.group.id,
        inviteRole,
      );
      setLastCreatedInvite(createdInviteLink);
      setNotice("Invite link создан.");
      await reloadSelectedGroup(selectedState.snapshot.group.id, true);
      await reloadGroups();
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось создать invite link.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setIsCreatingInviteLink(false);
    }
  }

  async function handleDisableInviteLink(inviteLinkId: string) {
    if (selectedState.status !== "ready") {
      return;
    }

    setPendingDisableInviteId(inviteLinkId);
    setActionError(null);
    setNotice(null);

    try {
      await gatewayClient.disableGroupInviteLink(
        token,
        selectedState.snapshot.group.id,
        inviteLinkId,
      );
      setNotice("Invite link отозван.");
      await reloadSelectedGroup(selectedState.snapshot.group.id, true);
      await reloadGroups();
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось отозвать invite link.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setPendingDisableInviteId(null);
    }
  }

  async function handleSendGroupMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedState.status !== "ready") {
      return;
    }

    const normalizedText = composerText.trim();
    if (normalizedText === "") {
      setActionError("Введите текст сообщения, прежде чем отправлять его.");
      setNotice(null);
      return;
    }

    setIsSendingMessage(true);
    setActionError(null);
    setNotice(null);

    try {
      await gatewayClient.sendGroupTextMessage(
        token,
        selectedState.snapshot.group.id,
        normalizedText,
      );
      setComposerText("");
      setNotice("Сообщение отправлено.");
      await reloadSelectedGroup(selectedState.snapshot.group.id, true);
      await reloadGroups();
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось отправить сообщение в группу.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setIsSendingMessage(false);
    }
  }

  async function handleUpdateGroupMemberRole(userId: string) {
    if (selectedState.status !== "ready") {
      return;
    }

    const member = selectedState.members.find((candidate) => candidate.user.id === userId);
    if (!member) {
      return;
    }

    const nextRole = memberRoleDrafts[userId] ?? member.role;
    if (nextRole === member.role) {
      return;
    }

    setPendingRoleUserId(userId);
    setActionError(null);
    setNotice(null);

    try {
      await gatewayClient.updateGroupMemberRole(
        token,
        selectedState.snapshot.group.id,
        userId,
        nextRole,
      );
      setNotice(`Роль ${member.user.nickname || `@${member.user.login}`} обновлена.`);
      await reloadSelectedGroup(selectedState.snapshot.group.id, true);
      await reloadGroups();
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось обновить роль участника.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setPendingRoleUserId(null);
    }
  }

  async function handleTransferOwnership(userId: string) {
    if (selectedState.status !== "ready") {
      return;
    }

    const member = selectedState.members.find((candidate) => candidate.user.id === userId);
    if (!member) {
      return;
    }
    if (
      !window.confirm(
        `Передать ownership участнику ${member.user.nickname || `@${member.user.login}`}? После этого ваша роль станет admin.`,
      )
    ) {
      return;
    }

    setPendingTransferUserId(userId);
    setActionError(null);
    setNotice(null);

    try {
      await gatewayClient.transferGroupOwnership(
        token,
        selectedState.snapshot.group.id,
        userId,
      );
      setNotice("Ownership передан. Текущая роль обновлена.");
      await reloadSelectedGroup(selectedState.snapshot.group.id, true);
      await reloadGroups();
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось передать ownership.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setPendingTransferUserId(null);
    }
  }

  async function handleRemoveGroupMember(userId: string) {
    if (selectedState.status !== "ready") {
      return;
    }

    const member = selectedState.members.find((candidate) => candidate.user.id === userId);
    if (!member) {
      return;
    }
    if (
      !window.confirm(
        `Удалить участника ${member.user.nickname || `@${member.user.login}`} из группы?`,
      )
    ) {
      return;
    }

    setPendingRemoveUserId(userId);
    setActionError(null);
    setNotice(null);

    try {
      await gatewayClient.removeGroupMember(token, selectedState.snapshot.group.id, userId);
      setNotice(`Участник ${member.user.nickname || `@${member.user.login}`} удалён из группы.`);
      await reloadSelectedGroup(selectedState.snapshot.group.id, true);
      await reloadGroups();
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось удалить участника.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setPendingRemoveUserId(null);
    }
  }

  async function handleLeaveGroup() {
    if (selectedState.status !== "ready") {
      return;
    }
    if (!window.confirm("Покинуть текущую группу?")) {
      return;
    }

    setIsLeavingGroup(true);
    setActionError(null);
    setNotice(null);

    try {
      await gatewayClient.leaveGroup(token, selectedState.snapshot.group.id);
      setNotice("Вы вышли из группы.");
      clearGroupSelection();
      await reloadGroups();
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось покинуть группу.",
        expireSession,
      );
      if (message !== null) {
        setActionError(message);
      }
    } finally {
      setIsLeavingGroup(false);
    }
  }

  async function reloadSelectedGroup(groupId: string, active: boolean) {
    try {
      const snapshot = await gatewayClient.getGroupChat(token, groupId);
      const membersPromise = gatewayClient.listGroupMembers(token, groupId);
      const messagesPromise = gatewayClient.listGroupMessages(token, groupId);
      const inviteLinksPromise = canManageInviteLinks(snapshot.group.selfRole)
        ? gatewayClient.listGroupInviteLinks(token, groupId)
        : Promise.resolve([]);
      const [members, messages, inviteLinks] = await Promise.all([
        membersPromise,
        messagesPromise,
        inviteLinksPromise,
      ]);
      if (!active) {
        return;
      }

      setSelectedState({
        status: "ready",
        snapshot,
        members,
        inviteLinks,
        messages,
        errorMessage: null,
      });
      setMemberRoleDrafts(buildMemberRoleDrafts(members));
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось открыть group chat через gateway.",
        expireSession,
      );
      if (!active || message === null) {
        return;
      }

      setSelectedState({
        status: "error",
        snapshot: null,
        members: [],
        inviteLinks: [],
        messages: [],
        errorMessage: message,
      });
      setMemberRoleDrafts({});
    }
  }

  function openGroup(groupId: string) {
    const params = new URLSearchParams();
    params.set("group", groupId);
    setSearchParams(params, { replace: true });
  }

  function clearGroupSelection() {
    setSearchParams(new URLSearchParams(), { replace: true });
    setComposerText("");
  }

  return (
    <div className={styles.layout}>
      <section className={styles.heroCard}>
        <div className={styles.heroHeader}>
          <div>
            <p className={styles.cardLabel}>Groups</p>
            <h1 className={styles.title}>Group membership management</h1>
            <p className={styles.subtitle}>
              Slice фиксирует canonical membership management: bounded role changes, explicit
              ownership transfer, remove member и leave group без group realtime, calls и media.
            </p>
          </div>

          <button
            className={styles.secondaryButton}
            disabled={groupsStatus === "loading" || isRefreshing}
            onClick={() => {
              void reloadGroups();
            }}
            type="button"
          >
            {isRefreshing ? "Обновляем..." : "Обновить"}
          </button>
        </div>

        <div className={styles.metrics}>
          <Metric label="Группы" value={groups.length} />
          <Metric
            label="В thread"
            value={selectedState.status === "ready" ? selectedState.messages.length : 0}
          />
          <Metric label="Активные invite links" value={activeInviteCount} />
        </div>

        {notice && <div className={styles.notice}>{notice}</div>}
        {actionError && <div className={styles.error}>{actionError}</div>}

        <div className={styles.heroForms}>
          <form className={styles.panelCard} onSubmit={handleCreateGroup}>
            <div className={styles.joinHeader}>
              <div>
                <p className={styles.cardLabel}>Create</p>
                <h2 className={styles.panelTitle}>Создать новую группу</h2>
              </div>
              <span className={styles.rolePill}>owner</span>
            </div>

            <p className={styles.description}>
              Создание группы сразу bootstrap'ит owner membership и primary message thread.
            </p>

            <div className={styles.form}>
              <label className={styles.field}>
                <span>Имя группы</span>
                <input
                  maxLength={80}
                  onChange={(event) => setGroupName(event.target.value)}
                  placeholder="Ops Room"
                  value={groupName}
                />
              </label>

              <button
                className={styles.primaryButton}
                disabled={isCreatingGroup}
                type="submit"
              >
                {isCreatingGroup ? "Создаём..." : "Создать"}
              </button>
            </div>
          </form>

          <form className={styles.joinCard} onSubmit={handleJoinByInviteLink}>
            <div className={styles.joinHeader}>
              <div>
                <p className={styles.cardLabel}>Join</p>
                <h2 className={styles.panelTitle}>Войти по invite link</h2>
              </div>
              {joinTokenFromRoute !== "" && <span className={styles.rolePill}>из URL</span>}
            </div>

            <p className={styles.description}>
              Вставьте полную ссылку или raw token. Публичного discovery по-прежнему нет.
            </p>

            <div className={styles.form}>
              <label className={styles.field}>
                <span>Invite link или token</span>
                <textarea
                  onChange={(event) => setJoinInput(event.target.value)}
                  placeholder="https://aerochat.local/app/groups?join=ginv_..."
                  value={joinInput}
                />
              </label>

              <button className={styles.primaryButton} disabled={isJoining} type="submit">
                {isJoining ? "Входим..." : "Присоединиться"}
              </button>
            </div>
          </form>
        </div>
      </section>

      <div className={styles.workspace}>
        <aside className={styles.sideColumn}>
          <section className={styles.panelCard}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.cardLabel}>Список</p>
                <h2 className={styles.panelTitle}>Ваши группы</h2>
              </div>
              <p className={styles.panelCopy}>
                List view остаётся membership-scoped и идёт только через `ChatService` на gateway.
              </p>
            </div>

            {groupsStatus === "loading" && (
              <InlineState
                title="Подтягиваем группы"
                message="Запрашиваем membership-scoped список групп через gateway."
              />
            )}

            {groupsStatus === "error" && (
              <InlineState
                title="Список групп недоступен"
                message={groupsError ?? "Не удалось получить группы."}
                action={
                  <button
                    className={styles.primaryButton}
                    onClick={() => {
                      void reloadGroups();
                    }}
                    type="button"
                  >
                    Повторить
                  </button>
                }
                tone="error"
              />
            )}

            {groupsStatus === "ready" && groups.length === 0 && (
              <p className={styles.emptyState}>
                Вы ещё не состоите ни в одной группе. Создайте новую группу или войдите по invite
                link.
              </p>
            )}

            {groupsStatus === "ready" && groups.length > 0 && (
              <div className={styles.list}>
                {groups.map((group) => (
                  <button
                    key={group.id}
                    className={styles.groupButton}
                    onClick={() => openGroup(group.id)}
                    type="button"
                  >
                    <article
                      className={styles.groupCard}
                      data-active={group.id === selectedGroupId}
                    >
                      <div className={styles.groupHeader}>
                        <div>
                          <h3 className={styles.groupTitle}>{group.name}</h3>
                          <p className={styles.groupMeta}>
                            {group.memberCount} участников • роль {roleLabel(group.selfRole)}
                          </p>
                        </div>
                        <span className={styles.rolePill}>{roleLabel(group.selfRole)}</span>
                      </div>
                    </article>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>

        <section className={styles.mainColumn}>
          {selectedState.status === "idle" && (
            <InlineState
              title="Группа не выбрана"
              message="Откройте группу из списка слева или используйте explicit join по invite link."
            />
          )}

          {selectedState.status === "loading" && (
            <InlineState
              title="Открываем группу"
              message="Загружаем metadata, primary thread, участников и историю сообщений."
            />
          )}

          {selectedState.status === "error" && (
            <InlineState
              title="Группа сейчас недоступна"
              message={selectedState.errorMessage}
              action={
                <button
                  className={styles.secondaryButton}
                  onClick={clearGroupSelection}
                  type="button"
                >
                  Вернуться к списку
                </button>
              }
              tone="error"
            />
          )}

          {selectedState.status === "ready" && (
            <>
              <section className={styles.panelCard}>
                <div className={styles.splitHeader}>
                  <div>
                    <p className={styles.cardLabel}>Group shell</p>
                    <h2 className={styles.panelTitle}>{selectedState.snapshot.group.name}</h2>
                    <p className={styles.description}>
                      Текущая роль: {roleLabel(selectedState.snapshot.group.selfRole)}. Thread key:{" "}
                      `{selectedState.snapshot.thread.threadKey}`.
                    </p>
                  </div>

                  <div className={styles.badgeColumn}>
                    <span className={styles.statusPill}>
                      {selectedState.snapshot.thread.canSendMessages
                        ? "write allowed"
                        : "read only"}
                    </span>
                    {selectedState.snapshot.group.selfRole !== "owner" && (
                      <button
                        className={styles.dangerButton}
                        disabled={isLeavingGroup}
                        onClick={() => {
                          void handleLeaveGroup();
                        }}
                        type="button"
                      >
                        {isLeavingGroup ? "Выходим..." : "Покинуть группу"}
                      </button>
                    )}
                    <button
                      className={styles.secondaryButton}
                      onClick={clearGroupSelection}
                      type="button"
                    >
                      Закрыть
                    </button>
                  </div>
                </div>
              </section>

              <section className={styles.panelCard}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.cardLabel}>Timeline</p>
                    <h2 className={styles.panelTitle}>Primary group thread</h2>
                  </div>
                  <p className={styles.panelCopy}>
                    Здесь пока только text-only history. Group realtime, edit/delete и media
                    намеренно отложены.
                  </p>
                </div>

                <div className={styles.timelineMeta}>
                  <span className={styles.statusPill}>{threadMessages.length} сообщений</span>
                  <span className={styles.statusPill}>
                    updated {formatDateTime(selectedState.snapshot.thread.updatedAt)}
                  </span>
                </div>

                <div className={styles.messagesList}>
                  {threadMessages.length === 0 ? (
                    <InlineState
                      title="Сообщений пока нет"
                      message="Primary thread уже создан, но текстовый timeline ещё пуст."
                    />
                  ) : (
                    threadMessages.map((message) => (
                      <article className={styles.messageCard} key={message.id}>
                        <div className={styles.messageHeader}>
                          <div>
                            <p className={styles.messageAuthor}>
                              {describeMessageAuthor(
                                message.senderUserId,
                                authState.profile.id,
                                selectedState.members,
                              )}
                            </p>
                            <p className={styles.messageMeta}>
                              {formatDateTime(message.createdAt)}
                            </p>
                          </div>
                          <span className={styles.statusPill}>text</span>
                        </div>

                        <div className={styles.messageBody}>
                          <SafeMessageMarkdown text={message.text?.text ?? ""} />
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>

              <section className={styles.panelCard}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.cardLabel}>Composer</p>
                    <h2 className={styles.panelTitle}>Новое сообщение</h2>
                  </div>
                  <p className={styles.panelCopy}>
                    Raw HTML запрещён. Rendering остаётся в текущем safe markdown subset.
                  </p>
                </div>

                {!selectedState.snapshot.thread.canSendMessages && (
                  <div className={styles.readOnlyNotice}>
                    Роль `reader` видит историю группы, но не может отправлять сообщения.
                  </div>
                )}

                <form className={styles.composer} onSubmit={handleSendGroupMessage}>
                  <label className={styles.field}>
                    <span>Текст сообщения</span>
                    <textarea
                      disabled={
                        isSendingMessage || !selectedState.snapshot.thread.canSendMessages
                      }
                      maxLength={4000}
                      onChange={(event) => {
                        setComposerText(event.target.value);
                        setActionError(null);
                      }}
                      placeholder={
                        selectedState.snapshot.thread.canSendMessages
                          ? "Напишите текстовое сообщение в primary thread"
                          : "Эта роль читает историю без отправки"
                      }
                      rows={5}
                      value={composerText}
                    />
                  </label>

                  <div className={styles.composerFooter}>
                    <span className={styles.characterCount}>{composerText.trim().length}/4000</span>
                    <button
                      className={styles.primaryButton}
                      disabled={
                        isSendingMessage ||
                        !selectedState.snapshot.thread.canSendMessages ||
                        composerText.trim() === ""
                      }
                      type="submit"
                    >
                      {isSendingMessage ? "Отправляем..." : "Отправить"}
                    </button>
                  </div>
                </form>
              </section>

              <section className={styles.panelCard}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.cardLabel}>Members</p>
                    <h2 className={styles.panelTitle}>Участники группы</h2>
                  </div>
                  <p className={styles.panelCopy}>
                    Список участников доступен всем membership roles, включая `reader`. Управление
                    ролями и удаление участников в этом PR остаются owner-only.
                  </p>
                </div>

                {selectedState.snapshot.group.selfRole === "owner" ? (
                  <div className={styles.notice}>
                    Ownership нельзя потерять неявно. Чтобы owner вышел из группы, сначала нужен
                    явный `TransferGroupOwnership`, затем обычный `LeaveGroup`.
                  </div>
                ) : (
                  <p className={styles.helperText}>
                    Текущая роль может только просматривать roster и при необходимости выполнить
                    self-leave.
                  </p>
                )}

                {selectedState.members.length === 0 ? (
                  <p className={styles.emptyState}>Backend пока не вернул участников группы.</p>
                ) : (
                  <div className={styles.memberList}>
                    {selectedState.members.map((member) => {
                      const isCurrentUser = member.user.id === authState.profile.id;
                      const draftRole = memberRoleDrafts[member.user.id] ?? member.role;
                      const canAdjustRole =
                        canManageMembership && !isCurrentUser && member.role !== "owner";
                      const canTransferOwnership =
                        canManageMembership && !isCurrentUser && member.role !== "owner";
                      const canRemoveMember =
                        canManageMembership && !isCurrentUser && member.role !== "owner";

                      return (
                        <article className={styles.memberCard} key={member.user.id}>
                          <div className={styles.memberHeader}>
                            <div>
                              <strong>{member.user.nickname}</strong>
                              <p className={styles.groupMeta}>@{member.user.login}</p>
                              <p className={styles.helperText}>
                                В группе с {formatDateTime(member.joinedAt)}
                                {isCurrentUser ? " • это вы" : ""}
                              </p>
                            </div>
                            <span className={styles.rolePill}>{roleLabel(member.role)}</span>
                          </div>

                          {canAdjustRole && (
                            <div className={styles.memberActions}>
                              <label className={styles.field}>
                                <span>Новая роль</span>
                                <select
                                  onChange={(event) =>
                                    setMemberRoleDrafts((current) => ({
                                      ...current,
                                      [member.user.id]: event.target.value as GroupMemberRole,
                                    }))
                                  }
                                  value={draftRole}
                                >
                                  <option value="admin">admin</option>
                                  <option value="member">member</option>
                                  <option value="reader">reader</option>
                                </select>
                              </label>

                              <div className={styles.memberButtons}>
                                <button
                                  className={styles.secondaryButton}
                                  disabled={
                                    pendingRoleUserId === member.user.id || draftRole === member.role
                                  }
                                  onClick={() => {
                                    void handleUpdateGroupMemberRole(member.user.id);
                                  }}
                                  type="button"
                                >
                                  {pendingRoleUserId === member.user.id
                                    ? "Сохраняем..."
                                    : "Обновить роль"}
                                </button>

                                <button
                                  className={styles.secondaryButton}
                                  disabled={pendingTransferUserId === member.user.id}
                                  onClick={() => {
                                    void handleTransferOwnership(member.user.id);
                                  }}
                                  type="button"
                                >
                                  {pendingTransferUserId === member.user.id
                                    ? "Передаём..."
                                    : "Передать ownership"}
                                </button>

                                <button
                                  className={styles.dangerButton}
                                  disabled={pendingRemoveUserId === member.user.id}
                                  onClick={() => {
                                    void handleRemoveGroupMember(member.user.id);
                                  }}
                                  type="button"
                                >
                                  {pendingRemoveUserId === member.user.id
                                    ? "Удаляем..."
                                    : "Удалить"}
                                </button>
                              </div>
                            </div>
                          )}

                          {!canAdjustRole &&
                            !canTransferOwnership &&
                            !canRemoveMember &&
                            isCurrentUser && (
                              <p className={styles.helperText}>
                                {selectedState.snapshot.group.selfRole === "owner"
                                  ? "Owner не может покинуть группу без явной передачи ownership."
                                  : "Для self-leave используйте кнопку в верхней панели группы."}
                              </p>
                            )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className={styles.panelCard}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.cardLabel}>Invite links</p>
                    <h2 className={styles.panelTitle}>Role-scoped invite links</h2>
                  </div>
                  <p className={styles.panelCopy}>
                    Invite links по-прежнему управляются только `owner`/`admin`.
                  </p>
                </div>

                {!canManageInviteLinks(selectedState.snapshot.group.selfRole) && (
                  <p className={styles.emptyState}>
                    Текущая роль не управляет invite links. Для этого требуется `owner` или
                    `admin`.
                  </p>
                )}

                {canManageInviteLinks(selectedState.snapshot.group.selfRole) && (
                  <>
                    <form className={styles.form} onSubmit={handleCreateInviteLink}>
                      <label className={styles.field}>
                        <span>Роль по invite link</span>
                        <select
                          onChange={(event) =>
                            setInviteRole(event.target.value as GroupMemberRole)
                          }
                          value={inviteRole}
                        >
                          {selectedState.snapshot.group.selfRole === "owner" && (
                            <option value="admin">admin</option>
                          )}
                          <option value="member">member</option>
                          <option value="reader">reader</option>
                        </select>
                      </label>

                      <button
                        className={styles.primaryButton}
                        disabled={isCreatingInviteLink}
                        type="submit"
                      >
                        {isCreatingInviteLink ? "Создаём..." : "Создать invite link"}
                      </button>
                    </form>

                    {lastCreatedInvite && (
                      <article className={styles.inviteCard}>
                        <div className={styles.inviteHeader}>
                          <div>
                            <strong>Последний созданный invite link</strong>
                            <p className={styles.groupMeta}>
                              Роль: {roleLabel(lastCreatedInvite.inviteLink.role)}
                            </p>
                          </div>
                          <span className={styles.statusPill}>new</span>
                        </div>

                        <p className={styles.inviteValue}>
                          {buildGroupInviteUrl(lastCreatedInvite.inviteToken)}
                        </p>
                      </article>
                    )}

                    {selectedState.inviteLinks.length === 0 ? (
                      <p className={styles.emptyState}>
                        Для этой группы ещё нет созданных invite links.
                      </p>
                    ) : (
                      <div className={styles.inviteList}>
                        {selectedState.inviteLinks.map((inviteLink) => (
                          <article className={styles.inviteCard} key={inviteLink.id}>
                            <div className={styles.inviteHeader}>
                              <div>
                                <strong>{roleLabel(inviteLink.role)}</strong>
                                <p className={styles.groupMeta}>
                                  join count: {inviteLink.joinCount} • создано{" "}
                                  {formatDateTime(inviteLink.createdAt)}
                                </p>
                              </div>

                              <span
                                className={styles.statusPill}
                                data-tone={inviteLink.disabledAt ? "danger" : "default"}
                              >
                                {inviteLink.disabledAt ? "disabled" : "active"}
                              </span>
                            </div>

                            <div className={styles.inviteActions}>
                              <p className={styles.helperText}>
                                {inviteLink.disabledAt
                                  ? `Отключён ${formatDateTime(inviteLink.disabledAt)}`
                                  : "Ссылка активна и готова к explicit join."}
                              </p>

                              <button
                                className={styles.dangerButton}
                                disabled={
                                  inviteLink.disabledAt !== null ||
                                  pendingDisableInviteId === inviteLink.id
                                }
                                onClick={() => {
                                  void handleDisableInviteLink(inviteLink.id);
                                }}
                                type="button"
                              >
                                {pendingDisableInviteId === inviteLink.id
                                  ? "Отзываем..."
                                  : "Отозвать"}
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </section>
      </div>
    </div>
  );

  function describeMessageAuthor(
    senderUserId: string,
    currentUserId: string,
    members: GroupMember[],
  ): string {
    if (senderUserId === currentUserId) {
      return "Вы";
    }

    const member = members.find((candidate) => candidate.user.id === senderUserId);
    if (!member) {
      return "Участник группы";
    }

    return member.user.nickname || `@${member.user.login}`;
  }
}

interface MetricProps {
  label: string;
  value: number;
}

function Metric({ label, value }: MetricProps) {
  return (
    <div className={styles.metricCard}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

interface InlineStateProps {
  title: string;
  message: string;
  action?: ReactNode;
  tone?: "default" | "error";
}

function InlineState({
  title,
  message,
  action,
  tone = "default",
}: InlineStateProps) {
  return (
    <section className={styles.stateCard} data-tone={tone}>
      <p className={styles.cardLabel}>Groups state</p>
      <h3 className={styles.stateTitle}>{title}</h3>
      <p className={styles.stateMessage}>{message}</p>
      {action && <div className={styles.actions}>{action}</div>}
    </section>
  );
}

function canManageInviteLinks(role: GroupMemberRole): boolean {
  return role === "owner" || role === "admin";
}

function buildMemberRoleDrafts(members: GroupMember[]): Record<string, GroupMemberRole> {
  return members.reduce<Record<string, GroupMemberRole>>((acc, member) => {
    acc[member.user.id] = member.role;
    return acc;
  }, {});
}

function roleLabel(role: GroupMemberRole): string {
  switch (role) {
    case "owner":
      return "owner";
    case "admin":
      return "admin";
    case "member":
      return "member";
    case "reader":
      return "reader";
    default:
      return role;
  }
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

function resolveProtectedError(
  error: unknown,
  fallbackMessage: string,
  onUnauthenticated: () => void,
): string | null {
  if (isGatewayErrorCode(error, "unauthenticated")) {
    onUnauthenticated();
    return null;
  }

  return describeGatewayError(error, fallbackMessage);
}
