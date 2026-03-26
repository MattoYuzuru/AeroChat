import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { gatewayClient } from "../gateway/runtime";
import {
  describeGatewayError,
  isGatewayErrorCode,
  type Group,
} from "../gateway/types";
import { buildGroupChatRoutePath } from "../app/app-routes";
import { useDesktopShellHost } from "../shell/context";
import styles from "./CreateGroupPage.module.css";

type GroupsLoadState =
  | { status: "loading" }
  | { status: "ready"; groups: Group[] }
  | { status: "error"; message: string };

export function CreateGroupPage() {
  const { state: authState, expireSession } = useAuth();
  const desktopShellHost = useDesktopShellHost();
  const navigate = useNavigate();
  const [groupName, setGroupName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [groupsLoadState, setGroupsLoadState] = useState<GroupsLoadState>({
    status: "loading",
  });

  const token = authState.status === "authenticated" ? authState.token : "";
  const recentGroups = useMemo(() => {
    if (groupsLoadState.status !== "ready") {
      return [];
    }

    return [...groupsLoadState.groups]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 4);
  }, [groupsLoadState]);

  useEffect(() => {
    if (authState.status !== "authenticated") {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const groups = await gatewayClient.listGroups(authState.token);
        if (cancelled) {
          return;
        }

        setGroupsLoadState({
          status: "ready",
          groups,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = resolveProtectedError(
          error,
          "Не удалось загрузить список групп.",
          expireSession,
        );
        if (message !== null) {
          setGroupsLoadState({
            status: "error",
            message,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authState, expireSession]);

  if (authState.status !== "authenticated") {
    return null;
  }

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = groupName.trim();
    if (normalizedName === "") {
      setActionError("Введите имя группы, прежде чем создавать её.");
      setNotice(null);
      return;
    }

    setIsCreating(true);
    setActionError(null);
    setNotice(null);

    try {
      const group = await gatewayClient.createGroup(token, normalizedName);
      setGroupName("");
      setNotice("Группа создана. Открываем каноническое окно переписки.");
      void refreshGroupsList();
      openGroup(group);
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
      setIsCreating(false);
    }
  }

  async function refreshGroupsList() {
    try {
      const groups = await gatewayClient.listGroups(token);
      setGroupsLoadState({
        status: "ready",
        groups,
      });
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось обновить список групп.",
        expireSession,
      );
      if (message !== null) {
        setGroupsLoadState({
          status: "error",
          message,
        });
      }
    }
  }

  function openGroup(group: Pick<Group, "id" | "name">) {
    if (desktopShellHost !== null) {
      desktopShellHost.openGroupChat({
        groupId: group.id,
        title: group.name,
      });
      return;
    }

    navigate(buildGroupChatRoutePath(group.id));
  }

  return (
    <div className={styles.layout}>
      <section className={styles.heroCard}>
        <div className={styles.heroContent}>
          <div>
            <p className={styles.eyebrow}>Новая группа</p>
            <h1 className={styles.title}>Создать новую группу</h1>
            <p className={styles.subtitle}>
              Отдельное окно для быстрого создания группы без перехода в общий список.
            </p>
          </div>

          <div className={styles.metrics}>
            <Metric
              label="Группы"
              value={groupsLoadState.status === "ready" ? groupsLoadState.groups.length : "…"}
            />
            <Metric label="Роль" value="владелец" />
            <Metric label="Окно" value="основное" />
          </div>
        </div>
      </section>

      {(notice !== null || actionError !== null) && (
        <section className={styles.feedbackStack}>
          {notice !== null && <div className={styles.notice}>{notice}</div>}
          {actionError !== null && <div className={styles.error}>{actionError}</div>}
        </section>
      )}

      <div className={styles.workspace}>
        <section className={styles.windowCard}>
          <div className={styles.windowTitleBar}>
            <span className={styles.windowTitle}>Мастер создания группы</span>
            <span className={styles.windowMeta}>AeroChat</span>
          </div>

          <div className={styles.windowBody}>
            <form className={styles.formPanel} onSubmit={handleCreateGroup}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.panelLabel}>Создание</p>
                  <h2 className={styles.panelTitle}>Новый workspace для участников</h2>
                </div>
                <span className={styles.roleBadge}>владелец</span>
              </div>

              <p className={styles.description}>
                После создания вы сразу станете участником группы и откроете её переписку.
              </p>

              <label className={styles.field}>
                <span>Имя группы</span>
                <input
                  autoFocus
                  maxLength={80}
                  onChange={(event) => {
                    setGroupName(event.target.value);
                  }}
                  placeholder="Совет проекта"
                  value={groupName}
                />
              </label>

              <div className={styles.buttonRow}>
                <button className={styles.primaryButton} disabled={isCreating} type="submit">
                  {isCreating ? "Создаём..." : "Создать группу"}
                </button>
                <button
                  className={styles.secondaryButton}
                  onClick={() => {
                    if (desktopShellHost !== null) {
                      desktopShellHost.launchApp("groups");
                      return;
                    }

                    navigate("/app/groups");
                  }}
                  type="button"
                >
                  Открыть список групп
                </button>
              </div>
            </form>

            <aside className={styles.sidePanel}>
              <section className={styles.infoPanel}>
                <p className={styles.panelLabel}>Что произойдёт</p>
                <ul className={styles.infoList}>
                  <li>владелец создаётся сразу</li>
                  <li>переписка группы откроется без лишних шагов</li>
                  <li>ярлык самой группы появится автоматически</li>
                  <li>ярлык можно вернуть через проводник</li>
                </ul>
              </section>

              <section className={styles.infoPanel}>
                <p className={styles.panelLabel}>Недавние группы</p>
                {groupsLoadState.status === "loading" && (
                  <p className={styles.stateText}>Подтягиваем актуальный список групп...</p>
                )}
                {groupsLoadState.status === "error" && (
                  <p className={styles.stateText}>{groupsLoadState.message}</p>
                )}
                {groupsLoadState.status === "ready" && recentGroups.length === 0 && (
                  <p className={styles.stateText}>
                    Пока нет ни одной группы. Созданная здесь группа станет первым target.
                  </p>
                )}
                {groupsLoadState.status === "ready" && recentGroups.length > 0 && (
                  <div className={styles.groupList}>
                    {recentGroups.map((group) => (
                      <button
                        key={group.id}
                        className={styles.groupLink}
                        onClick={() => {
                          openGroup(group);
                        }}
                        type="button"
                      >
                        <span className={styles.groupLinkTitle}>{group.name}</span>
                        <small>
                          unread {group.unreadCount + group.encryptedUnreadCount} · обновлено{" "}
                          {formatRelativeIsoDate(group.updatedAt)}
                        </small>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </aside>
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatRelativeIsoDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "недавно";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
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
