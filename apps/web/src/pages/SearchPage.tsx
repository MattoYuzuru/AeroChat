import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { useCryptoRuntime } from "../crypto/useCryptoRuntime";
import { gatewayClient } from "../gateway/runtime";
import {
  describeGatewayError,
  isGatewayErrorCode,
  type DirectChat,
  type Group,
  type MessageSearchCursor,
  type MessageSearchResult,
} from "../gateway/types";
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
import styles from "./SearchPage.module.css";

const SEARCH_PAGE_SIZE = 20;

interface SubmittedSearch {
  query: string;
  scopeSelection: SearchScopeSelection;
  scope: NonNullable<ReturnType<typeof buildMessageSearchScope>>;
}

type SearchPathStatus = "idle" | "loading" | "ready" | "error";
type EncryptedSearchPathStatus = SearchPathStatus | "unavailable";

export function SearchPage() {
  const { state: authState, expireSession } = useAuth();
  const cryptoRuntime = useCryptoRuntime();
  const [query, setQuery] = useState("");
  const [scopeSelection, setScopeSelection] = useState<SearchScopeSelection>("all-direct");
  const [selectedDirectChatId, setSelectedDirectChatId] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [directChats, setDirectChats] = useState<DirectChat[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [metadataStatus, setMetadataStatus] = useState<"loading" | "ready" | "error">("loading");
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
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
  const isRunningSearch =
    legacySearchStatus === "loading" || encryptedSearchStatus === "loading" || isLoadingMore;

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
          "Не удалось загрузить доступные direct chats и группы для поиска.",
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
        "Не удалось обновить direct chats и группы для поиска.",
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authState.status !== "authenticated") {
      return;
    }

    const normalizedQuery = query.trim();
    if (normalizedQuery === "") {
      setFormError("Введите текстовый запрос, прежде чем запускать поиск.");
      return;
    }

    const scope = buildMessageSearchScope(
      scopeSelection,
      selectedDirectChatId,
      selectedGroupId,
    );
    if (scope === null) {
      setFormError(
        scopeSelection === "direct"
          ? "Выберите конкретный личный чат."
          : "Выберите конкретную группу.",
      );
      return;
    }

    setFormError(null);
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
      authState.status !== "authenticated" ||
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
    if (authState.status !== "authenticated") {
      return;
    }

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
          "Не удалось выполнить поиск legacy plaintext сообщений через gateway.",
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
            "Не удалось выполнить local encrypted search в текущем browser profile.",
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

  if (authState.status !== "authenticated") {
    return null;
  }

  return (
    <div className={styles.layout}>
      <section className={styles.heroCard}>
        <div className={styles.heroHeader}>
          <div>
            <p className={styles.cardLabel}>Search</p>
            <h1 className={styles.title}>Поиск сообщений</h1>
            <p className={styles.subtitle}>
              `/app/search` сохраняет текущий entrypoint, но честно разделяет два path:
              server-backed legacy plaintext search и local encrypted search по bounded decrypted
              окну текущего browser/runtime.
            </p>
          </div>

          <button
            className={styles.secondaryButton}
            disabled={metadataStatus === "loading" || isRefreshingMetadata}
            onClick={() => {
              void reloadCollections();
            }}
            type="button"
          >
            {isRefreshingMetadata ? "Обновляем..." : "Обновить списки"}
          </button>
        </div>

        <div className={styles.metrics}>
          <Metric label="Direct chats" value={directChats.length} />
          <Metric label="Группы" value={groups.length} />
          <Metric label="Legacy hits" value={legacyResults.length} />
          <Metric label="Encrypted hits" value={encryptedResults.length} />
        </div>

        {metadataStatus === "error" && metadataError && (
          <div className={styles.error}>{metadataError}</div>
        )}
        {formError && <div className={styles.error}>{formError}</div>}

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>Текстовый запрос</span>
            <input
              disabled={metadataStatus !== "ready" || isRunningSearch}
              maxLength={200}
              onChange={(event) => {
                setQuery(event.target.value);
                setFormError(null);
              }}
              placeholder="Например: release notes"
              value={query}
            />
          </label>

          <div className={styles.controlsGrid}>
            <label className={styles.field}>
              <span>Scope</span>
              <select
                disabled={metadataStatus !== "ready" || isRunningSearch}
                onChange={(event) => {
                  const nextValue = event.target.value as SearchScopeSelection;
                  setScopeSelection(nextValue);
                  setFormError(null);
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
                  disabled={metadataStatus !== "ready" || directChats.length === 0 || isRunningSearch}
                  onChange={(event) => {
                    setSelectedDirectChatId(event.target.value);
                    setFormError(null);
                  }}
                  value={selectedDirectChatId}
                >
                  <option value="">Выберите direct chat</option>
                  {directChats.map((chat) => (
                    <option key={chat.id} value={chat.id}>
                      {describeDirectChatLabel(chat, currentUserId)}
                    </option>
                  ))}
                </select>
                {directChats.length === 0 && (
                  <small className={styles.helperText}>
                    Доступных личных чатов пока нет.
                  </small>
                )}
              </label>
            )}

            {scopeSelection === "group" && (
              <label className={styles.field}>
                <span>Группа</span>
                <select
                  disabled={metadataStatus !== "ready" || groups.length === 0 || isRunningSearch}
                  onChange={(event) => {
                    setSelectedGroupId(event.target.value);
                    setFormError(null);
                  }}
                  value={selectedGroupId}
                >
                  <option value="">Выберите группу</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name.trim() === "" ? "Группа" : group.name}
                    </option>
                  ))}
                </select>
                {groups.length === 0 && (
                  <small className={styles.helperText}>
                    Доступных групп пока нет.
                  </small>
                )}
              </label>
            )}
          </div>

          <div className={styles.formFooter}>
            <p className={styles.scopeHint}>
              Текущий scope:{" "}
              <strong>
                {describeSearchScope(scopeSelection)}
                {selectedDirectChat
                  ? ` · ${describeDirectChatLabel(selectedDirectChat, currentUserId)}`
                  : ""}
                {selectedGroup ? ` · ${selectedGroup.name || "Группа"}` : ""}
              </strong>
            </p>

            <button
              className={styles.primaryButton}
              disabled={metadataStatus !== "ready" || isRunningSearch}
              type="submit"
            >
              {legacySearchStatus === "loading" || encryptedSearchStatus === "loading"
                ? "Ищем..."
                : "Искать"}
            </button>
          </div>
        </form>
      </section>

      {metadataStatus === "loading" && (
        <StateCard
          title="Подготавливаем search bootstrap"
          message="Загружаем direct chats и группы, чтобы форма могла явно ограничивать scope и честно подписывать legacy/encrypted results."
        />
      )}

      {metadataStatus === "error" && (
        <StateCard
          title="Search bootstrap недоступен"
          message={metadataError ?? "Не удалось загрузить входные данные для поиска."}
          action={
            <button
              className={styles.primaryButton}
              onClick={() => {
                void reloadCollections();
              }}
              type="button"
            >
              Повторить
            </button>
          }
          tone="error"
        />
      )}

      {metadataStatus === "ready" && (
        <section className={styles.resultsSection}>
          <div className={styles.resultsHeader}>
            <div>
              <p className={styles.cardLabel}>Results</p>
              <h2 className={styles.sectionTitle}>Найденные сообщения</h2>
              <p className={styles.sectionDescription}>
                {searchScopeSummary ??
                  "Один и тот же query/scope теперь честно идёт по двум путям: legacy plaintext через gateway и encrypted local search по bounded decrypted окну."}
              </p>
            </div>

            {submittedSearch && (
              <span className={styles.metaTag}>
                {legacyResults.length} legacy / {encryptedResults.length} encrypted
              </span>
            )}
          </div>

          {submittedSearch !== null && (
            <div className={styles.limitNotice}>
              Legacy results приходят из `SearchMessages`, а encrypted results строятся только
              локально. Jump для encrypted target работает только если он уже materialized в
              текущем bounded local projection.
            </div>
          )}

          {submittedSearch === null && (
            <InlineState
              title="Поиск ещё не запускался"
              message="Legacy path остаётся server-backed для plaintext history. Encrypted path intentionally bounded: без server-side plaintext indexing, без deep history backfill и без claims о full parity."
            />
          )}

          {submittedSearch !== null && (
            <div className={styles.pathGrid}>
              <section className={styles.pathSection}>
                <div className={styles.pathHeader}>
                  <div>
                    <p className={styles.cardLabel}>Legacy Path</p>
                    <h3 className={styles.pathTitle}>Server plaintext search</h3>
                    <p className={styles.pathDescription}>
                      Текущий `SearchMessages` path для legacy plaintext history остаётся без
                      архитектурных изменений.
                    </p>
                  </div>
                  <span className={styles.metaTag}>
                    {legacySearchStatus === "loading"
                      ? "Ищем..."
                      : legacyResults.length === 0
                        ? "0 hit'ов"
                        : `${legacyResults.length} hit'ов`}
                  </span>
                </div>

                {legacySearchStatus === "loading" && (
                  <InlineState
                    title="Ищем legacy сообщения"
                    message="Выполняем server-backed запрос через существующий SearchMessages API."
                  />
                )}

                {legacySearchStatus === "error" && (
                  <InlineState
                    title="Legacy path недоступен"
                    message={
                      legacySearchError ??
                      "Не удалось выполнить поиск legacy plaintext сообщений."
                    }
                    tone="error"
                  />
                )}

                {legacySearchStatus === "ready" && legacyResults.length === 0 && (
                  <InlineState
                    title="Legacy plaintext совпадений нет"
                    message="В этом scope серверный plaintext path не вернул подходящих сообщений."
                  />
                )}

                {legacyResults.length > 0 && (
                  <>
                    <div className={styles.resultList}>
                      {legacyResults.map((result) => (
                        <SearchResultCard
                          currentUserId={currentUserId}
                          directChats={directChats}
                          groups={groups}
                          key={`legacy:${result.messageId}:${result.createdAt}`}
                          pathLabel="Legacy server"
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
                          {isLoadingMore ? "Загружаем..." : "Загрузить ещё"}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </section>

              <section className={styles.pathSection}>
                <div className={styles.pathHeader}>
                  <div>
                    <p className={styles.cardLabel}>Encrypted Path</p>
                    <h3 className={styles.pathTitle}>Local encrypted search</h3>
                    <p className={styles.pathDescription}>
                      Поиск идёт только по локально fetched + decrypted message text. Decrypted
                      index хранится только в памяти текущей browser session.
                    </p>
                  </div>
                  <span className={styles.metaTag}>
                    {encryptedSearchStatus === "loading"
                      ? "Готовим..."
                      : encryptedResults.length === 0
                        ? "0 hit'ов"
                        : `${encryptedResults.length} hit'ов`}
                  </span>
                </div>

                {encryptedSummary && (
                  <div className={styles.limitNotice}>
                    {describeEncryptedSummary(encryptedSummary, submittedSearch.scopeSelection)}
                  </div>
                )}

                {encryptedSearchStatus === "loading" && (
                  <InlineState
                    title="Готовим encrypted local search"
                    message="Подтягиваем opaque envelopes, локально расшифровываем bounded window и строим session-local index без server-side plaintext fallback."
                  />
                )}

                {encryptedSearchStatus === "unavailable" && (
                  <InlineState
                    title="Encrypted path недоступен"
                    message={
                      encryptedSearchError ??
                      "Текущий browser profile ещё не готов к local encrypted search."
                    }
                    tone="error"
                  />
                )}

                {encryptedSearchStatus === "error" && (
                  <InlineState
                    title="Encrypted local search не выполнен"
                    message={
                      encryptedSearchError ??
                      "Не удалось выполнить local encrypted search в текущем browser profile."
                    }
                    tone="error"
                  />
                )}

                {encryptedSearchStatus === "ready" && encryptedResults.length === 0 && (
                  <InlineState
                    title="Encrypted совпадений нет"
                    message="В текущем локально indexed окне encrypted conversations подходящих message bodies не найдено."
                  />
                )}

                {encryptedSearchStatus === "ready" && encryptedSearchError && (
                  <div className={styles.error}>{encryptedSearchError}</div>
                )}

                {encryptedResults.length > 0 && (
                  <div className={styles.resultList}>
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
      )}
    </div>
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

interface StateCardProps {
  title: string;
  message: string;
  action?: ReactNode;
  tone?: "default" | "error";
}

function StateCard({
  title,
  message,
  action,
  tone = "default",
}: StateCardProps) {
  return (
    <section className={styles.stateCard} data-tone={tone}>
      <p className={styles.cardLabel}>Search state</p>
      <h2 className={styles.stateTitle}>{title}</h2>
      <p className={styles.stateMessage}>{message}</p>
      {action && <div className={styles.stateActions}>{action}</div>}
    </section>
  );
}

interface InlineStateProps {
  title: string;
  message: string;
  tone?: "default" | "error";
}

function InlineState({
  title,
  message,
  tone = "default",
}: InlineStateProps) {
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
      return `Запрос: “${search.query}” · ${describeSearchScope(search.scopeSelection)} · ${chat ? describeDirectChatLabel(chat, currentUserId) : "Личный чат"}`;
    }
  }

  if (search.scope.kind === "group") {
    const groupID = search.scope.groupId?.trim() ?? "";
    if (groupID !== "") {
      const group = groups.find((entry) => entry.id === groupID) ?? null;
      return `Запрос: “${search.query}” · ${describeSearchScope(search.scopeSelection)} · ${group?.name || "Группа"}`;
    }
  }

  return `Запрос: “${search.query}” · ${describeSearchScope(search.scopeSelection)}`;
}

function describeEncryptedSummary(
  summary: EncryptedLocalSearchSummary,
  scopeSelection: SearchScopeSelection,
): string {
  const base =
    scopeSelection === "direct" || scopeSelection === "group"
      ? `Локально просмотрено текущее bounded окно encrypted lane: до ${summary.laneMessageLimit} decrypted сообщений.`
      : `Локально просмотрено ${summary.searchedLaneCount} из ${summary.availableLaneCount} recent encrypted lanes, до ${summary.laneMessageLimit} decrypted сообщений на lane.`;

  const limited = summary.limitedByLaneBudget
    ? ` All-scope encrypted search ограничен recent lane budget ${summary.laneLimit}.`
    : "";
  const failures =
    summary.failedLaneCount > 0
      ? ` ${summary.failedLaneCount} lane не удалось локально подготовить в этом запросе.`
      : "";

  return `${base} Session-local cache ограничен ${summary.cacheLaneLimit} lanes.${limited}${failures}`;
}

function normalizeMatchFragment(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized === "") {
    return "Фрагмент совпадения недоступен.";
  }

  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
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
