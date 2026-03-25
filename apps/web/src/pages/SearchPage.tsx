import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  buildGroupChatRoutePath,
  buildPersonProfileRoutePath,
} from "../app/app-routes";
import { useAuth } from "../auth/useAuth";
import { useCryptoRuntime } from "../crypto/useCryptoRuntime";
import { gatewayClient } from "../gateway/runtime";
import {
  describeGatewayError,
  isGatewayErrorCode,
  type DirectChat,
  type Group,
  type GroupInvitePreview,
  type MessageSearchCursor,
  type MessageSearchResult,
} from "../gateway/types";
import { extractGroupInviteToken } from "../groups/invite-token";
import {
  describePersonProfileSummary,
  describePersonRelationship,
  findExactKnownPeopleEntries,
  findSimilarKnownPeopleEntries,
  getPersonProfileLaunchTitle,
  listKnownPeopleEntries,
  normalizeExactLoginQuery,
  type PersonProfileEntry,
} from "../people/profile-model";
import { usePeople } from "../people/usePeople";
import {
  searchEncryptedLocalMessages,
  type EncryptedLocalSearchResult,
  type EncryptedLocalSearchSummary,
} from "../search/encrypted-local-search";
import {
  buildMessageSearchScope,
  buildSearchResultHref,
  describeDirectChatLabel,
  describeSearchResultAuthor,
  describeSearchResultContainer,
  describeSearchResultScope,
  describeSearchScope,
  type SearchResultLike,
  type SearchScopeSelection,
} from "../search/model";
import { useDesktopShellHost } from "../shell/context";
import styles from "./SearchPage.module.css";

const SEARCH_PAGE_SIZE = 20;
const KNOWN_PEOPLE_LIMIT = 4;

interface SubmittedSearch {
  query: string;
  scopeSelection: SearchScopeSelection;
  scope: NonNullable<ReturnType<typeof buildMessageSearchScope>>;
}

type SearchPathStatus = "idle" | "loading" | "ready" | "error";
type EncryptedSearchPathStatus = SearchPathStatus | "unavailable";
type InvitePreviewStatus = "idle" | "loading" | "ready" | "error";

export function SearchPage() {
  const navigate = useNavigate();
  const { state: authState, expireSession } = useAuth();
  const cryptoRuntime = useCryptoRuntime();
  const desktopShellHost = useDesktopShellHost();
  const [peopleLogin, setPeopleLogin] = useState("");
  const [peopleFormError, setPeopleFormError] = useState<string | null>(null);
  const [inviteInput, setInviteInput] = useState("");
  const [invitePreviewStatus, setInvitePreviewStatus] = useState<InvitePreviewStatus>("idle");
  const [invitePreviewError, setInvitePreviewError] = useState<string | null>(null);
  const [invitePreview, setInvitePreview] = useState<GroupInvitePreview | null>(null);
  const [isJoiningInvite, setIsJoiningInvite] = useState(false);
  const [messageQuery, setMessageQuery] = useState("");
  const [scopeSelection, setScopeSelection] = useState<SearchScopeSelection>("all-direct");
  const [selectedDirectChatId, setSelectedDirectChatId] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [directChats, setDirectChats] = useState<DirectChat[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [metadataStatus, setMetadataStatus] = useState<"loading" | "ready" | "error">("loading");
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false);
  const [contentSearchFormError, setContentSearchFormError] = useState<string | null>(null);
  const [legacySearchStatus, setLegacySearchStatus] = useState<SearchPathStatus>("idle");
  const [legacySearchError, setLegacySearchError] = useState<string | null>(null);
  const [legacyResults, setLegacyResults] = useState<MessageSearchResult[]>([]);
  const [nextPageCursor, setNextPageCursor] = useState<MessageSearchCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [encryptedSearchStatus, setEncryptedSearchStatus] =
    useState<EncryptedSearchPathStatus>("idle");
  const [encryptedSearchError, setEncryptedSearchError] = useState<string | null>(null);
  const [encryptedResults, setEncryptedResults] = useState<EncryptedLocalSearchResult[]>([]);
  const [encryptedSummary, setEncryptedSummary] = useState<EncryptedLocalSearchSummary | null>(
    null,
  );
  const [submittedSearch, setSubmittedSearch] = useState<SubmittedSearch | null>(null);
  const searchRequestIDRef = useRef(0);
  const token = authState.status === "authenticated" ? authState.token : "";
  const currentUserId =
    authState.status === "authenticated" ? authState.profile.id : "";
  const people = usePeople({
    enabled: authState.status === "authenticated",
    token,
    onUnauthenticated: expireSession,
  });
  const isRunningContentSearch =
    legacySearchStatus === "loading" || encryptedSearchStatus === "loading" || isLoadingMore;
  const normalizedPeopleLogin = normalizeExactLoginQuery(peopleLogin);
  const inviteToken = extractGroupInviteToken(inviteInput);

  useEffect(() => {
    if (authState.status !== "authenticated") {
      return;
    }

    let active = true;

    void loadCollections("initial");

    return () => {
      active = false;
    };

    async function loadCollections(mode: "initial" | "refresh") {
      if (mode === "initial") {
        setMetadataStatus("loading");
      } else {
        setIsRefreshingMetadata(true);
      }

      setMetadataError(null);

      try {
        const [nextDirectChats, nextGroups] = await Promise.all([
          gatewayClient.listDirectChats(token),
          gatewayClient.listGroups(token),
        ]);

        if (!active) {
          return;
        }

        setDirectChats(nextDirectChats);
        setGroups(nextGroups);
        setMetadataStatus("ready");
      } catch (error) {
        const message = resolveProtectedError(
          error,
          "Не удалось загрузить чаты и группы.",
          expireSession,
        );
        if (!active || message === null) {
          return;
        }

        setDirectChats([]);
        setGroups([]);
        setMetadataStatus("error");
        setMetadataError(message);
      } finally {
        if (active) {
          setIsRefreshingMetadata(false);
        }
      }
    }
  }, [authState.status, expireSession, token]);

  if (authState.status !== "authenticated") {
    return null;
  }

  const exactPeopleMatches =
    normalizedPeopleLogin === "" || people.state.status !== "ready"
      ? []
      : findExactKnownPeopleEntries(people.state.snapshot, peopleLogin);
  const similarPeopleMatches =
    normalizedPeopleLogin === "" || people.state.status !== "ready" || exactPeopleMatches.length > 0
      ? []
      : findSimilarKnownPeopleEntries(people.state.snapshot, peopleLogin);
  const knownPeopleEntries =
    normalizedPeopleLogin !== "" || people.state.status !== "ready"
      ? []
      : listKnownPeopleEntries(people.state.snapshot, KNOWN_PEOPLE_LIMIT);

  const selectedDirectChat =
    selectedDirectChatId.trim() === ""
      ? null
      : directChats.find((chat) => chat.id === selectedDirectChatId) ?? null;
  const selectedGroup =
    selectedGroupId.trim() === ""
      ? null
      : groups.find((group) => group.id === selectedGroupId) ?? null;
  const searchScopeSummary =
    submittedSearch === null
      ? null
      : describeSubmittedSearch(
          submittedSearch,
          directChats,
          groups,
          currentUserId,
        );

  async function reloadCollections() {
    if (authState.status !== "authenticated") {
      return;
    }

    setIsRefreshingMetadata(true);
    setMetadataError(null);

    try {
      const [nextDirectChats, nextGroups] = await Promise.all([
        gatewayClient.listDirectChats(token),
        gatewayClient.listGroups(token),
      ]);

      setDirectChats(nextDirectChats);
      setGroups(nextGroups);
      setMetadataStatus("ready");
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось обновить чаты и группы.",
        expireSession,
      );
      if (message !== null) {
        setDirectChats([]);
        setGroups([]);
        setMetadataStatus("error");
        setMetadataError(message);
      }
    } finally {
      setIsRefreshingMetadata(false);
    }
  }

  function openPersonProfile(entry: PersonProfileEntry) {
    const title = getPersonProfileLaunchTitle(entry.profile);
    const searchParams = new URLSearchParams({
      from: "search",
    });

    if (desktopShellHost !== null) {
      desktopShellHost.openPersonProfile({
        userId: entry.profile.id,
        title,
        searchParams,
      });
    }

    navigate(buildPersonProfileRoutePath(entry.profile.id, searchParams));
  }

  function openGroupTarget(groupId: string, title: string) {
    if (desktopShellHost !== null) {
      desktopShellHost.openGroupChat({
        groupId,
        title,
      });
    }

    navigate(buildGroupChatRoutePath(groupId));
  }

  async function handlePeopleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedLogin = normalizeExactLoginQuery(peopleLogin);

    if (normalizedLogin === "") {
      setPeopleFormError("Введите точный login.");
      people.clearFeedback();
      return;
    }

    setPeopleFormError(null);
    const success = await people.sendFriendRequest(normalizedLogin);
    if (success) {
      setPeopleLogin("");
    }
  }

  async function handleInvitePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (inviteToken === "") {
      setInvitePreviewStatus("error");
      setInvitePreview(null);
      setInvitePreviewError("Вставьте invite link или raw invite token.");
      return;
    }

    setInvitePreviewStatus("loading");
    setInvitePreviewError(null);
    setInvitePreview(null);

    try {
      const preview = await gatewayClient.previewGroupByInviteLink(token, inviteToken);
      setInvitePreview(preview);
      setInvitePreviewStatus("ready");
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось показать превью invite link.",
        expireSession,
      );
      if (message === null) {
        return;
      }

      setInvitePreviewStatus("error");
      setInvitePreview(null);
      setInvitePreviewError(message);
    }
  }

  async function handleInviteJoin() {
    if (invitePreview === null) {
      return;
    }

    if (invitePreview.alreadyJoined) {
      openGroupTarget(invitePreview.groupId, normalizeGroupTitle(invitePreview.groupName));
      return;
    }

    setIsJoiningInvite(true);
    setInvitePreviewError(null);

    try {
      const group = await gatewayClient.joinGroupByInviteLink(token, inviteToken);
      await reloadCollections();
      openGroupTarget(group.id, normalizeGroupTitle(group.name));
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось войти в группу по invite link.",
        expireSession,
      );
      if (message !== null) {
        setInvitePreviewError(message);
      }
    } finally {
      setIsJoiningInvite(false);
    }
  }

  async function handleContentSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedQuery = messageQuery.trim();
    if (normalizedQuery === "") {
      setContentSearchFormError("Введите текстовый запрос.");
      return;
    }

    const scope = buildMessageSearchScope(
      scopeSelection,
      selectedDirectChatId,
      selectedGroupId,
    );
    if (scope === null) {
      setContentSearchFormError(
        scopeSelection === "direct"
          ? "Выберите личный чат."
          : "Выберите группу.",
      );
      return;
    }

    setContentSearchFormError(null);
    await runSearch(
      {
        query: normalizedQuery,
        scopeSelection,
        scope,
      },
      null,
      "replace",
    );
  }

  async function handleLoadMore() {
    if (
      !submittedSearch ||
      nextPageCursor === null ||
      isLoadingMore
    ) {
      return;
    }

    await runSearch(submittedSearch, nextPageCursor, "append");
  }

  async function runSearch(
    request: SubmittedSearch,
    cursor: MessageSearchCursor | null,
    mode: "replace" | "append",
  ) {
    const requestID =
      mode === "replace" ? searchRequestIDRef.current + 1 : searchRequestIDRef.current;
    if (mode === "replace") {
      searchRequestIDRef.current = requestID;
      setSubmittedSearch(request);
      setLegacySearchStatus("loading");
      setLegacySearchError(null);
      setLegacyResults([]);
      setHasMore(false);
      setNextPageCursor(null);
      setEncryptedSearchStatus("loading");
      setEncryptedSearchError(null);
      setEncryptedResults([]);
      setEncryptedSummary(null);
    } else {
      setIsLoadingMore(true);
      setLegacySearchError(null);
    }

    try {
      if (mode === "append") {
        const response = await gatewayClient.searchMessages(token, {
          query: request.query,
          scope: request.scope,
          pageSize: SEARCH_PAGE_SIZE,
          pageCursor: cursor,
        });

        if (requestID !== searchRequestIDRef.current) {
          return;
        }

        setLegacyResults((current) => [...current, ...response.results]);
        setNextPageCursor(response.nextPageCursor);
        setHasMore(response.hasMore);
        return;
      }

      const [legacyResult, encryptedResult] = await Promise.allSettled([
        gatewayClient.searchMessages(token, {
          query: request.query,
          scope: request.scope,
          pageSize: SEARCH_PAGE_SIZE,
          pageCursor: null,
        }),
        searchEncryptedLocalMessages({
          query: request.query,
          scopeSelection: request.scopeSelection,
          directChats,
          groups,
          directChatId: selectedDirectChatId,
          groupId: selectedGroupId,
          token,
          cryptoRuntime,
        }),
      ]);

      if (requestID !== searchRequestIDRef.current) {
        return;
      }

      if (legacyResult.status === "fulfilled") {
        setLegacyResults(legacyResult.value.results);
        setLegacySearchStatus("ready");
        setNextPageCursor(legacyResult.value.nextPageCursor);
        setHasMore(legacyResult.value.hasMore);
      } else {
        const message = resolveProtectedError(
          legacyResult.reason,
          "Не удалось выполнить поиск по сообщениям.",
          expireSession,
        );
        if (message !== null) {
          setLegacySearchStatus("error");
          setLegacySearchError(message);
          setLegacyResults([]);
          setNextPageCursor(null);
          setHasMore(false);
        }
      }

      if (encryptedResult.status === "fulfilled") {
        setEncryptedResults(encryptedResult.value.results);
        setEncryptedSummary(encryptedResult.value.summary);
        setEncryptedSearchStatus(
          encryptedResult.value.status === "unavailable" ? "unavailable" : "ready",
        );
        setEncryptedSearchError(encryptedResult.value.errorMessage);
      } else {
        setEncryptedSearchStatus("error");
        setEncryptedSearchError(
          describeGatewayError(
            encryptedResult.reason,
            "Не удалось выполнить локальный поиск по encrypted окну.",
          ),
        );
        setEncryptedResults([]);
        setEncryptedSummary(null);
      }
    } finally {
      if (requestID === searchRequestIDRef.current && mode === "append") {
        setIsLoadingMore(false);
      }
    }
  }

  return (
    <div className={styles.layout}>
      <section className={styles.primarySection}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.cardLabel}>People</p>
            <h1 className={styles.title}>Люди и invite links</h1>
            <p className={styles.subtitle}>
              Сначала точный login, уже знакомые контакты и приглашения в группы. Поиск по
              сообщениям остаётся ниже как отдельный вторичный блок.
            </p>
          </div>

          <button
            className={styles.secondaryButton}
            disabled={people.state.isRefreshing || isRefreshingMetadata}
            onClick={() => {
              void people.reload();
              void reloadCollections();
            }}
            type="button"
          >
            {people.state.isRefreshing || isRefreshingMetadata ? "Обновляем..." : "Обновить"}
          </button>
        </div>

        <div className={styles.metrics}>
          <Metric label="Друзья" value={people.state.snapshot.friends.length} />
          <Metric label="Входящие" value={people.state.snapshot.incoming.length} />
          <Metric label="Исходящие" value={people.state.snapshot.outgoing.length} />
          <Metric label="Группы" value={groups.length} />
        </div>

        <div className={styles.primaryGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.cardLabel}>Точный login</p>
                <h2 className={styles.panelTitle}>Найти или добавить человека</h2>
                <p className={styles.panelDescription}>
                  Точный login остаётся основным путём. Уже известные контакты показываются
                  первыми, а похожие known-only подсказки остаются ограниченными.
                </p>
              </div>
            </div>

            {(peopleFormError || people.state.actionErrorMessage || people.state.notice) && (
              <div className={styles.stack}>
                {peopleFormError && <div className={styles.error}>{peopleFormError}</div>}
                {people.state.actionErrorMessage && (
                  <div className={styles.error}>{people.state.actionErrorMessage}</div>
                )}
                {people.state.notice && <div className={styles.notice}>{people.state.notice}</div>}
              </div>
            )}

            <form className={styles.form} onSubmit={handlePeopleSubmit}>
              <label className={styles.field}>
                <span>Login</span>
                <input
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect="off"
                  disabled={people.state.isSendingRequest}
                  onChange={(event) => {
                    setPeopleLogin(event.target.value);
                    setPeopleFormError(null);
                    people.clearFeedback();
                  }}
                  placeholder="alice"
                  spellCheck={false}
                  value={peopleLogin}
                />
              </label>

              <div className={styles.inlineActions}>
                <button
                  className={styles.primaryButton}
                  disabled={people.state.isSendingRequest}
                  type="submit"
                >
                  {people.state.isSendingRequest ? "Отправляем..." : "Отправить заявку"}
                </button>
                {normalizedPeopleLogin !== "" && exactPeopleMatches.length > 0 && (
                  <button
                    className={styles.secondaryButton}
                    onClick={() => {
                      openPersonProfile(exactPeopleMatches[0]!);
                    }}
                    type="button"
                  >
                    Открыть профиль
                  </button>
                )}
              </div>
            </form>

            {people.state.status === "loading" && (
              <InlineState
                title="Загружаем контакты"
                message="Получаем друзей и заявки."
              />
            )}

            {people.state.status === "error" && (
              <InlineState
                title="Контакты временно недоступны"
                message={people.state.screenErrorMessage ?? "Не удалось загрузить людей."}
                tone="error"
              />
            )}

            {people.state.status === "ready" && (
              <div className={styles.stack}>
                {exactPeopleMatches.length > 0 && (
                  <>
                    <SectionNote
                      title="Точное совпадение"
                      message="Откройте canonical профиль контакта."
                    />
                    <div className={styles.cardList}>
                      {exactPeopleMatches.map((entry) => (
                        <KnownPersonCard
                          entry={entry}
                          key={`${entry.relationshipKind}:${entry.profile.id}`}
                          onOpenProfile={() => {
                            openPersonProfile(entry);
                          }}
                        />
                      ))}
                    </div>
                  </>
                )}

                {exactPeopleMatches.length === 0 && similarPeopleMatches.length > 0 && (
                  <>
                    <SectionNote
                      title="Похожие известные люди"
                      message="Это только ваши текущие друзья и заявки."
                    />
                    <div className={styles.cardList}>
                      {similarPeopleMatches.map((entry) => (
                        <KnownPersonCard
                          entry={entry}
                          key={`${entry.relationshipKind}:${entry.profile.id}`}
                          onOpenProfile={() => {
                            openPersonProfile(entry);
                          }}
                        />
                      ))}
                    </div>
                  </>
                )}

                {normalizedPeopleLogin === "" && knownPeopleEntries.length > 0 && (
                  <>
                    <SectionNote
                      title="Известные люди"
                      message="Быстрый доступ к текущим контактам и заявкам."
                    />
                    <div className={styles.cardList}>
                      {knownPeopleEntries.map((entry) => (
                        <KnownPersonCard
                          entry={entry}
                          key={`${entry.relationshipKind}:${entry.profile.id}`}
                          onOpenProfile={() => {
                            openPersonProfile(entry);
                          }}
                        />
                      ))}
                    </div>
                  </>
                )}

                {normalizedPeopleLogin !== "" &&
                  exactPeopleMatches.length === 0 &&
                  similarPeopleMatches.length === 0 && (
                    <InlineState
                      title="Среди известных людей совпадений нет"
                      message="Можно отправить новую заявку по точному login."
                    />
                  )}
              </div>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.cardLabel}>Invite link</p>
                <h2 className={styles.panelTitle}>Посмотреть группу перед входом</h2>
                <p className={styles.panelDescription}>
                  Сначала превью, потом явное действие. Автовхода по вставленной ссылке нет.
                </p>
              </div>
            </div>

            {(invitePreviewError || invitePreviewStatus === "ready") && (
              <div className={styles.stack}>
                {invitePreviewError && <div className={styles.error}>{invitePreviewError}</div>}
              </div>
            )}

            <form className={styles.form} onSubmit={handleInvitePreview}>
              <label className={styles.field}>
                <span>Ссылка или token</span>
                <input
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect="off"
                  disabled={invitePreviewStatus === "loading" || isJoiningInvite}
                  onChange={(event) => {
                    setInviteInput(event.target.value);
                    setInvitePreview(null);
                    setInvitePreviewStatus("idle");
                    setInvitePreviewError(null);
                  }}
                  placeholder="https://.../app/groups?join=ginv_..."
                  spellCheck={false}
                  value={inviteInput}
                />
              </label>

              <div className={styles.inlineActions}>
                <button
                  className={styles.primaryButton}
                  disabled={invitePreviewStatus === "loading" || isJoiningInvite}
                  type="submit"
                >
                  {invitePreviewStatus === "loading" ? "Проверяем..." : "Показать превью"}
                </button>
              </div>
            </form>

            {invitePreviewStatus === "idle" && (
              <InlineState
                title="Вставьте invite link"
                message="Покажем группу и роль по ссылке до вступления."
              />
            )}

            {invitePreviewStatus === "ready" && invitePreview !== null && (
              <article className={styles.previewCard}>
                <div className={styles.previewHeader}>
                  <div>
                    <div className={styles.badgeRow}>
                      <span className={styles.metaBadge}>Группа</span>
                      <span className={styles.scopeBadge}>
                        Роль: {describeInviteRole(invitePreview.inviteRole)}
                      </span>
                    </div>
                    <h3 className={styles.resultTitle}>
                      {normalizeGroupTitle(invitePreview.groupName)}
                    </h3>
                    <p className={styles.resultMeta}>
                      {describeMemberCount(invitePreview.memberCount)}
                      {invitePreview.alreadyJoined ? " · вы уже участник" : ""}
                    </p>
                  </div>
                </div>

                <div className={styles.inlineActions}>
                  <button
                    className={styles.primaryButton}
                    disabled={isJoiningInvite}
                    onClick={() => {
                      void handleInviteJoin();
                    }}
                    type="button"
                  >
                    {isJoiningInvite
                      ? "Выполняем..."
                      : invitePreview.alreadyJoined
                        ? "Открыть группу"
                        : "Вступить в группу"}
                  </button>
                </div>
              </article>
            )}
          </section>
        </div>
      </section>

      <section className={styles.secondarySection}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.cardLabel}>Messages</p>
            <h2 className={styles.sectionTitle}>Поиск по сообщениям</h2>
            <p className={styles.sectionDescription}>
              Дополнительный поиск внутри чатов и групп. Обычные сообщения ищутся через сервер,
              encrypted сообщения только локально и в пределах текущего окна.
            </p>
          </div>

          <span className={styles.metaTag}>
            {submittedSearch ? `${legacyResults.length} / ${encryptedResults.length}` : "Вторично"}
          </span>
        </div>

        {metadataStatus === "error" && metadataError && (
          <div className={styles.error}>{metadataError}</div>
        )}
        {contentSearchFormError && <div className={styles.error}>{contentSearchFormError}</div>}

        <form className={styles.form} onSubmit={handleContentSearchSubmit}>
          <label className={styles.field}>
            <span>Запрос</span>
            <input
              disabled={metadataStatus !== "ready" || isRunningContentSearch}
              maxLength={200}
              onChange={(event) => {
                setMessageQuery(event.target.value);
                setContentSearchFormError(null);
              }}
              placeholder="Например: release notes"
              value={messageQuery}
            />
          </label>

          <div className={styles.controlsGrid}>
            <label className={styles.field}>
              <span>Где искать</span>
              <select
                disabled={metadataStatus !== "ready" || isRunningContentSearch}
                onChange={(event) => {
                  const nextValue = event.target.value as SearchScopeSelection;
                  setScopeSelection(nextValue);
                  setContentSearchFormError(null);
                }}
                value={scopeSelection}
              >
                <option value="all-direct">Все личные чаты</option>
                <option value="direct">Один личный чат</option>
                <option value="all-groups">Все группы</option>
                <option value="group">Одна группа</option>
              </select>
            </label>

            {scopeSelection === "direct" && (
              <label className={styles.field}>
                <span>Личный чат</span>
                <select
                  disabled={metadataStatus !== "ready" || directChats.length === 0 || isRunningContentSearch}
                  onChange={(event) => {
                    setSelectedDirectChatId(event.target.value);
                    setContentSearchFormError(null);
                  }}
                  value={selectedDirectChatId}
                >
                  <option value="">Выберите чат</option>
                  {directChats.map((chat) => (
                    <option key={chat.id} value={chat.id}>
                      {describeDirectChatLabel(chat, currentUserId)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {scopeSelection === "group" && (
              <label className={styles.field}>
                <span>Группа</span>
                <select
                  disabled={metadataStatus !== "ready" || groups.length === 0 || isRunningContentSearch}
                  onChange={(event) => {
                    setSelectedGroupId(event.target.value);
                    setContentSearchFormError(null);
                  }}
                  value={selectedGroupId}
                >
                  <option value="">Выберите группу</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {normalizeGroupTitle(group.name)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className={styles.formFooter}>
            <p className={styles.scopeHint}>
              {describeSearchScope(scopeSelection)}
              {selectedDirectChat
                ? ` · ${describeDirectChatLabel(selectedDirectChat, currentUserId)}`
                : ""}
              {selectedGroup ? ` · ${normalizeGroupTitle(selectedGroup.name)}` : ""}
            </p>

            <div className={styles.inlineActions}>
              <button
                className={styles.secondaryButton}
                disabled={metadataStatus === "loading" || isRefreshingMetadata}
                onClick={() => {
                  void reloadCollections();
                }}
                type="button"
              >
                {isRefreshingMetadata ? "Обновляем..." : "Списки"}
              </button>
              <button
                className={styles.primaryButton}
                disabled={metadataStatus !== "ready" || isRunningContentSearch}
                type="submit"
              >
                {legacySearchStatus === "loading" || encryptedSearchStatus === "loading"
                  ? "Ищем..."
                  : "Искать"}
              </button>
            </div>
          </div>
        </form>

        {metadataStatus === "loading" && (
          <InlineState
            title="Подготавливаем поиск"
            message="Загружаем чаты и группы для ограничения области."
          />
        )}

        {submittedSearch === null && metadataStatus === "ready" && (
          <InlineState
            title="Поиск по сообщениям ещё не запускался"
            message="Результаты появятся ниже после первого запроса."
          />
        )}

        {submittedSearch !== null && (
          <div className={styles.pathGrid}>
            <section className={styles.pathSection}>
              <div className={styles.pathHeader}>
                <div>
                  <p className={styles.cardLabel}>Обычные сообщения</p>
                  <h3 className={styles.pathTitle}>Server-backed</h3>
                  <p className={styles.pathDescription}>
                    {searchScopeSummary ?? "Поиск по plaintext истории в выбранной области."}
                  </p>
                </div>
                <span className={styles.metaTag}>
                  {legacySearchStatus === "loading"
                    ? "Ищем..."
                    : `${legacyResults.length} результатов`}
                </span>
              </div>

              {legacySearchStatus === "loading" && (
                <InlineState
                  title="Ищем сообщения"
                  message="Сервер обрабатывает запрос."
                />
              )}

              {legacySearchStatus === "error" && (
                <InlineState
                  title="Поиск недоступен"
                  message={legacySearchError ?? "Не удалось получить результаты."}
                  tone="error"
                />
              )}

              {legacySearchStatus === "ready" && legacyResults.length === 0 && (
                <InlineState
                  title="Ничего не найдено"
                  message="В этой области подходящих сообщений нет."
                />
              )}

              {legacyResults.length > 0 && (
                <>
                  <div className={styles.cardList}>
                    {legacyResults.map((result) => (
                      <SearchResultCard
                        currentUserId={currentUserId}
                        directChats={directChats}
                        groups={groups}
                        key={`legacy:${result.messageId}:${result.createdAt}`}
                        pathLabel="Server"
                        result={result}
                      />
                    ))}
                  </div>

                  {hasMore && (
                    <div className={styles.loadMoreRow}>
                      <button
                        className={styles.secondaryButton}
                        disabled={isLoadingMore}
                        onClick={() => {
                          void handleLoadMore();
                        }}
                        type="button"
                      >
                        {isLoadingMore ? "Загружаем..." : "Показать ещё"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>

            <section className={styles.pathSection}>
              <div className={styles.pathHeader}>
                <div>
                  <p className={styles.cardLabel}>Encrypted</p>
                  <h3 className={styles.pathTitle}>Локально в браузере</h3>
                  <p className={styles.pathDescription}>
                    Только локально расшифрованное bounded окно текущей сессии.
                  </p>
                </div>
                <span className={styles.metaTag}>
                  {encryptedSearchStatus === "loading"
                    ? "Ищем..."
                    : `${encryptedResults.length} результатов`}
                </span>
              </div>

              {encryptedSummary && (
                <div className={styles.notice}>
                  {describeEncryptedSummary(encryptedSummary, submittedSearch.scopeSelection)}
                </div>
              )}

              {encryptedSearchStatus === "loading" && (
                <InlineState
                  title="Готовим локальный индекс"
                  message="Поиск идёт только по доступному encrypted окну."
                />
              )}

              {(encryptedSearchStatus === "unavailable" || encryptedSearchStatus === "error") && (
                <InlineState
                  title="Локальный encrypted поиск недоступен"
                  message={
                    encryptedSearchError ?? "Текущий браузерный профиль не смог подготовить окно."
                  }
                  tone="error"
                />
              )}

              {encryptedSearchStatus === "ready" && encryptedResults.length === 0 && (
                <InlineState
                  title="Совпадений нет"
                  message="В локальном encrypted окне ничего не найдено."
                />
              )}

              {encryptedResults.length > 0 && (
                <div className={styles.cardList}>
                  {encryptedResults.map((result) => (
                    <SearchResultCard
                      currentUserId={currentUserId}
                      directChats={directChats}
                      groups={groups}
                      key={`encrypted:${result.messageId}:${result.createdAt}`}
                      pathLabel="Encrypted local"
                      result={result}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

function KnownPersonCard({
  entry,
  onOpenProfile,
}: {
  entry: PersonProfileEntry;
  onOpenProfile(): void;
}) {
  return (
    <article className={styles.resultCard}>
      <div className={styles.resultHeaderRow}>
        <div>
          <div className={styles.badgeRow}>
            <span className={styles.scopeBadge}>Люди</span>
            <span className={styles.metaBadge}>{describeShortRelationship(entry)}</span>
          </div>
          <h3 className={styles.resultTitle}>{entry.profile.nickname}</h3>
          <p className={styles.resultMeta}>
            @{entry.profile.login} · {describePersonRelationship(entry)}
          </p>
        </div>

        <button className={styles.linkButton} onClick={onOpenProfile} type="button">
          Профиль
        </button>
      </div>

      <p className={styles.fragment}>{describePersonProfileSummary(entry.profile)}</p>
    </article>
  );
}

interface SearchResultCardProps {
  currentUserId: string;
  directChats: DirectChat[];
  groups: Group[];
  pathLabel: string;
  result: SearchResultLike & {
    createdAt: string;
    editedAt: string | null;
    matchFragment: string;
  };
}

function SearchResultCard({
  currentUserId,
  directChats,
  groups,
  pathLabel,
  result,
}: SearchResultCardProps) {
  return (
    <article className={styles.resultCard}>
      <div className={styles.resultHeaderRow}>
        <div>
          <div className={styles.badgeRow}>
            <span className={styles.scopeBadge}>{describeSearchResultScope(result)}</span>
            <span className={styles.pathBadge}>{pathLabel}</span>
            {result.editedAt && <span className={styles.metaBadge}>Изменено</span>}
          </div>
          <h3 className={styles.resultTitle}>
            {describeSearchResultContainer(result, directChats, groups, currentUserId)}
          </h3>
          <p className={styles.resultMeta}>
            {describeSearchResultAuthor(result.author, currentUserId)} ·{" "}
            {formatDateTime(result.createdAt)}
            {result.editedAt && ` · ред. ${formatDateTime(result.editedAt)}`}
          </p>
        </div>

        <Link className={styles.linkButton} to={buildSearchResultHref(result)}>
          Открыть
        </Link>
      </div>

      <p className={styles.fragment}>{normalizeMatchFragment(result.matchFragment)}</p>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.metricCard}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SectionNote({ title, message }: { title: string; message: string }) {
  return (
    <div className={styles.sectionNote}>
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}

function InlineState({
  title,
  message,
  tone = "default",
}: {
  title: string;
  message: string;
  tone?: "default" | "error";
}) {
  return (
    <div className={styles.inlineState} data-tone={tone}>
      <h3 className={styles.inlineStateTitle}>{title}</h3>
      <p className={styles.inlineStateMessage}>{message}</p>
    </div>
  );
}

function describeSubmittedSearch(
  search: SubmittedSearch,
  directChats: DirectChat[],
  groups: Group[],
  currentUserId: string,
): string {
  if (search.scope.kind === "direct") {
    const chatID = search.scope.chatId?.trim() ?? "";
    if (chatID !== "") {
      const chat = directChats.find((entry) => entry.id === chatID) ?? null;
      return `${describeSearchScope(search.scopeSelection)} · ${chat ? describeDirectChatLabel(chat, currentUserId) : "Личный чат"}`;
    }
  }

  if (search.scope.kind === "group") {
    const groupID = search.scope.groupId?.trim() ?? "";
    if (groupID !== "") {
      const group = groups.find((entry) => entry.id === groupID) ?? null;
      return `${describeSearchScope(search.scopeSelection)} · ${group ? normalizeGroupTitle(group.name) : "Группа"}`;
    }
  }

  return describeSearchScope(search.scopeSelection);
}

function describeEncryptedSummary(
  summary: EncryptedLocalSearchSummary,
  scopeSelection: SearchScopeSelection,
): string {
  const base =
    scopeSelection === "direct" || scopeSelection === "group"
      ? `Просмотрено до ${summary.laneMessageLimit} локально расшифрованных сообщений.`
      : `Просмотрено ${summary.searchedLaneCount} из ${summary.availableLaneCount} recent encrypted lanes, до ${summary.laneMessageLimit} сообщений на lane.`;

  const limited = summary.limitedByLaneBudget
    ? ` Ограничение all-scope: ${summary.laneLimit} lanes.`
    : "";
  const failures =
    summary.failedLaneCount > 0
      ? ` Не удалось подготовить ${summary.failedLaneCount} lanes.`
      : "";

  return `${base} Локальный кэш ограничен ${summary.cacheLaneLimit} lanes.${limited}${failures}`;
}

function normalizeMatchFragment(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized === "") {
    return "Фрагмент совпадения недоступен.";
  }

  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

function normalizeGroupTitle(value: string): string {
  const normalized = value.trim();
  return normalized === "" ? "Группа" : normalized;
}

function describeInviteRole(role: GroupInvitePreview["inviteRole"]): string {
  switch (role) {
    case "owner":
      return "owner";
    case "admin":
      return "admin";
    case "reader":
      return "reader";
    case "member":
    default:
      return "member";
  }
}

function describeMemberCount(count: number): string {
  if (count % 10 === 1 && count % 100 !== 11) {
    return `${count} участник`;
  }

  if (
    count % 10 >= 2 &&
    count % 10 <= 4 &&
    (count % 100 < 10 || count % 100 >= 20)
  ) {
    return `${count} участника`;
  }

  return `${count} участников`;
}

function describeShortRelationship(entry: PersonProfileEntry): string {
  switch (entry.relationshipKind) {
    case "friend":
      return "Друг";
    case "incoming_request":
      return "Входящая";
    case "outgoing_request":
      return "Исходящая";
    default:
      return "Контакт";
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
  expireSession: () => void,
): string | null {
  if (isGatewayErrorCode(error, "unauthenticated")) {
    expireSession();
    return null;
  }

  return describeGatewayError(error, fallbackMessage);
}
