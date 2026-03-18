import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { gatewayClient } from "../gateway/runtime";
import {
  describeGatewayError,
  isGatewayErrorCode,
  type CreatedGroupInviteLink,
  type Group,
  type GroupInviteLink,
  type GroupMember,
  type GroupMemberRole,
} from "../gateway/types";
import { buildGroupInviteUrl, extractGroupInviteToken } from "../groups/invite-token";
import styles from "./GroupsPage.module.css";

type SelectedState =
  | {
      status: "idle";
      group: null;
      members: GroupMember[];
      inviteLinks: GroupInviteLink[];
      errorMessage: null;
    }
  | {
      status: "loading";
      group: null;
      members: GroupMember[];
      inviteLinks: GroupInviteLink[];
      errorMessage: null;
    }
  | {
      status: "ready";
      group: Group;
      members: GroupMember[];
      inviteLinks: GroupInviteLink[];
      errorMessage: null;
    }
  | {
      status: "error";
      group: null;
      members: GroupMember[];
      inviteLinks: GroupInviteLink[];
      errorMessage: string;
    };

const initialSelectedState: SelectedState = {
  status: "idle",
  group: null,
  members: [],
  inviteLinks: [],
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
  const [inviteRole, setInviteRole] = useState<GroupMemberRole>("member");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isCreatingInviteLink, setIsCreatingInviteLink] = useState(false);
  const [pendingDisableInviteId, setPendingDisableInviteId] = useState<string | null>(null);
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
      return;
    }

    let active = true;
    setSelectedState({
      status: "loading",
      group: null,
      members: [],
      inviteLinks: [],
      errorMessage: null,
    });

    void (async () => {
      try {
        const group = await gatewayClient.getGroup(token, selectedGroupId);
        const membersPromise = gatewayClient.listGroupMembers(token, selectedGroupId);
        const inviteLinksPromise = canManageInviteLinks(group.selfRole)
          ? gatewayClient.listGroupInviteLinks(token, selectedGroupId)
          : Promise.resolve([]);
        const [members, inviteLinks] = await Promise.all([membersPromise, inviteLinksPromise]);
        if (!active) {
          return;
        }

        setSelectedState({
          status: "ready",
          group,
          members,
          inviteLinks,
          errorMessage: null,
        });
      } catch (error) {
        const message = resolveProtectedError(
          error,
          "Не удалось открыть группу через gateway.",
          expireSession,
        );
        if (!active || message === null) {
          return;
        }

        setSelectedState({
          status: "error",
          group: null,
          members: [],
          inviteLinks: [],
          errorMessage: message,
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [
    authState.status,
    token,
    expireSession,
    selectedGroupId,
  ]);

  if (authState.status !== "authenticated") {
    return null;
  }

  const activeInviteCount =
    selectedState.status === "ready"
      ? selectedState.inviteLinks.filter((inviteLink) => inviteLink.disabledAt === null).length
      : 0;
  const requestedJoinToken = extractGroupInviteToken(joinInput || joinTokenFromRoute);

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
        selectedState.group.id,
        inviteRole,
      );
      setLastCreatedInvite(createdInviteLink);
      setNotice("Invite link создан.");
      await reloadSelectedGroup(selectedState.group.id);
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
        selectedState.group.id,
        inviteLinkId,
      );
      setNotice("Invite link отозван.");
      await reloadSelectedGroup(selectedState.group.id);
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

  async function reloadSelectedGroup(groupId: string) {
    try {
      const group = await gatewayClient.getGroup(token, groupId);
      const [members, inviteLinks] = await Promise.all([
        gatewayClient.listGroupMembers(token, groupId),
        canManageInviteLinks(group.selfRole)
          ? gatewayClient.listGroupInviteLinks(token, groupId)
          : Promise.resolve([]),
      ]);

      setSelectedState({
        status: "ready",
        group,
        members,
        inviteLinks,
        errorMessage: null,
      });
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось обновить открытую группу.",
        expireSession,
      );
      if (message !== null) {
        setSelectedState({
          status: "error",
          group: null,
          members: [],
          inviteLinks: [],
          errorMessage: message,
        });
      }
    }
  }

  function openGroup(groupId: string) {
    const params = new URLSearchParams();
    params.set("group", groupId);
    setSearchParams(params, { replace: true });
  }

  function clearGroupSelection() {
    setSearchParams(new URLSearchParams(), { replace: true });
  }

  return (
    <div className={styles.layout}>
      <section className={styles.heroCard}>
        <div className={styles.heroHeader}>
          <div>
            <p className={styles.cardLabel}>Groups</p>
            <h1 className={styles.title}>Foundation для групп</h1>
            <p className={styles.subtitle}>
              Этот slice добавляет canonical group entity, membership roles, invite links и
              explicit join flow через существующий gateway-only web shell. Group messaging и calls
              здесь ещё не реализуются.
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
            label="Участники"
            value={selectedState.status === "ready" ? selectedState.members.length : 0}
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
              Создание группы сразу добавляет единственного `owner` и открывает базовый shell для
              участников.
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
              Вставьте полную ссылку или raw token. Join остаётся явным действием, публичного
              discovery здесь нет.
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
                Groups list идёт только через `ChatService` на gateway и показывает только группы,
                где текущий пользователь уже состоит.
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
              message="Загружаем group shell, участников и invite links по текущей роли."
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
                    <h2 className={styles.panelTitle}>{selectedState.group.name}</h2>
                    <p className={styles.description}>
                      Роль текущего пользователя: {roleLabel(selectedState.group.selfRole)}.
                      Здесь пока только foundation shell без group messages и realtime fan-out.
                    </p>
                  </div>

                  <button
                    className={styles.secondaryButton}
                    onClick={clearGroupSelection}
                    type="button"
                  >
                    Закрыть
                  </button>
                </div>
              </section>

              <section className={styles.panelCard}>
                <div className={styles.panelHeader}>
                  <div>
                    <p className={styles.cardLabel}>Members</p>
                    <h2 className={styles.panelTitle}>Участники группы</h2>
                  </div>
                  <p className={styles.panelCopy}>
                    Список участников доступен всем membership roles, включая `reader`.
                  </p>
                </div>

                {selectedState.members.length === 0 ? (
                  <p className={styles.emptyState}>Backend пока не вернул участников группы.</p>
                ) : (
                  <div className={styles.memberList}>
                    {selectedState.members.map((member) => (
                      <article className={styles.memberCard} key={member.user.id}>
                        <div className={styles.memberHeader}>
                          <div>
                            <strong>{member.user.nickname}</strong>
                            <p className={styles.groupMeta}>@{member.user.login}</p>
                          </div>
                          <span className={styles.rolePill}>{roleLabel(member.role)}</span>
                        </div>
                      </article>
                    ))}
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
                    Invite links видны и управляются только `owner`/`admin`. `reader` уже считается
                    реальной ролью, но full role management отложен.
                  </p>
                </div>

                {!canManageInviteLinks(selectedState.group.selfRole) && (
                  <p className={styles.emptyState}>
                    Текущая роль не управляет invite links. Для этого требуется `owner` или
                    `admin`.
                  </p>
                )}

                {canManageInviteLinks(selectedState.group.selfRole) && (
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
                          {selectedState.group.selfRole === "owner" && (
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
                                  ? `Отозвано ${formatDateTime(inviteLink.disabledAt)}`
                                  : `Invite ID: ${shortID(inviteLink.id)}`}
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
      <h2 className={styles.stateTitle}>{title}</h2>
      <p className={styles.stateMessage}>{message}</p>
      {action}
    </section>
  );
}

function canManageInviteLinks(role: GroupMemberRole) {
  return role === "owner" || role === "admin";
}

function roleLabel(role: GroupMemberRole) {
  return role;
}

function shortID(value: string) {
  if (value.trim() === "") {
    return "неизвестно";
  }
  if (value.length <= 12) {
    return value;
  }

  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function formatDateTime(value: string | null) {
  if (value === null || value.trim() === "") {
    return "неизвестно";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function resolveProtectedError(
  error: unknown,
  fallbackMessage: string,
  expireSession: (message?: string) => void,
) {
  if (isGatewayErrorCode(error, "unauthenticated")) {
    expireSession();
    return null;
  }

  return describeGatewayError(error, fallbackMessage);
}
