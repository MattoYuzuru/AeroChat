import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
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
  buildMessageSearchScope,
  buildSearchResultHref,
  describeDirectChatLabel,
  describeSearchResultAuthor,
  describeSearchResultContainer,
  describeSearchResultScope,
  describeSearchScope,
  type SearchScopeSelection,
} from "../search/model";
import styles from "./SearchPage.module.css";

const SEARCH_PAGE_SIZE = 20;

interface SubmittedSearch {
  query: string;
  scopeSelection: SearchScopeSelection;
  scope: NonNullable<ReturnType<typeof buildMessageSearchScope>>;
}

export function SearchPage() {
  const { state: authState, expireSession } = useAuth();
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
  const [searchStatus, setSearchStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<MessageSearchResult[]>([]);
  const [nextPageCursor, setNextPageCursor] = useState<MessageSearchCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [submittedSearch, setSubmittedSearch] = useState<SubmittedSearch | null>(null);
  const searchRequestIDRef = useRef(0);
  const token = authState.status === "authenticated" ? authState.token : "";
  const currentUserId =
    authState.status === "authenticated" ? authState.profile.id : "";

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
      setSearchError(null);
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
      setSearchError(null);
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
      setSearchStatus("loading");
      setSearchError(null);
      setResults([]);
      setHasMore(false);
      setNextPageCursor(null);
    } else {
      setIsLoadingMore(true);
      setSearchError(null);
    }

    try {
      const response = await gatewayClient.searchMessages(token, {
        query: request.query,
        scope: request.scope,
        pageSize: SEARCH_PAGE_SIZE,
        pageCursor: cursor,
      });

      if (requestID !== searchRequestIDRef.current) {
        return;
      }

      if (mode === "replace") {
        setSubmittedSearch(request);
        setResults(response.results);
        setSearchStatus("ready");
      } else {
        setResults((current) => [...current, ...response.results]);
      }

      setNextPageCursor(response.nextPageCursor);
      setHasMore(response.hasMore);
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось выполнить поиск сообщений через gateway.",
        expireSession,
      );
      if (message === null || requestID !== searchRequestIDRef.current) {
        return;
      }

      setSearchError(message);
      if (mode === "replace") {
        setSearchStatus("error");
        setResults([]);
        setHasMore(false);
        setNextPageCursor(null);
      }
    } finally {
      if (requestID === searchRequestIDRef.current) {
        if (mode === "append") {
          setIsLoadingMore(false);
        }
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
              Узкий web bootstrap поверх существующего `SearchMessages` API. Поиск остаётся
              gateway-only, а jump подсвечивает target message только внутри текущей загруженной
              истории direct chat или group.
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
          <Metric label="Результаты" value={results.length} />
        </div>

        {metadataStatus === "error" && metadataError && (
          <div className={styles.error}>{metadataError}</div>
        )}
        {formError && <div className={styles.error}>{formError}</div>}
        {searchError && <div className={styles.error}>{searchError}</div>}

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>Текстовый запрос</span>
            <input
              disabled={metadataStatus !== "ready" || searchStatus === "loading"}
              maxLength={200}
              onChange={(event) => {
                setQuery(event.target.value);
                setFormError(null);
                setSearchError(null);
              }}
              placeholder="Например: release notes"
              value={query}
            />
          </label>

          <div className={styles.controlsGrid}>
            <label className={styles.field}>
              <span>Scope</span>
              <select
                disabled={metadataStatus !== "ready" || searchStatus === "loading"}
                onChange={(event) => {
                  const nextValue = event.target.value as SearchScopeSelection;
                  setScopeSelection(nextValue);
                  setFormError(null);
                  setSearchError(null);
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
                  disabled={metadataStatus !== "ready" || directChats.length === 0}
                  onChange={(event) => {
                    setSelectedDirectChatId(event.target.value);
                    setFormError(null);
                    setSearchError(null);
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
                  disabled={metadataStatus !== "ready" || groups.length === 0}
                  onChange={(event) => {
                    setSelectedGroupId(event.target.value);
                    setFormError(null);
                    setSearchError(null);
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
                {selectedDirectChat ? ` · ${describeDirectChatLabel(selectedDirectChat, currentUserId)}` : ""}
                {selectedGroup ? ` · ${selectedGroup.name || "Группа"}` : ""}
              </strong>
            </p>

            <button
              className={styles.primaryButton}
              disabled={metadataStatus !== "ready" || searchStatus === "loading"}
              type="submit"
            >
              {searchStatus === "loading" ? "Ищем..." : "Искать"}
            </button>
          </div>
        </form>
      </section>

      {metadataStatus === "loading" && (
        <StateCard
          title="Подготавливаем search bootstrap"
          message="Загружаем доступные direct chats и группы, чтобы форма могла явно ограничивать scope и подписывать результаты."
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
                  "Выберите scope, введите запрос и запустите поиск по текущему stored text сообщений."}
              </p>
            </div>

            {submittedSearch && (
              <span className={styles.metaTag}>
                {results.length === 0 ? "0 hit'ов" : `${results.length} hit'ов`}
              </span>
            )}
          </div>

          {(searchStatus === "ready" || searchStatus === "error") && (
            <div className={styles.limitNotice}>
              Jump из результата подсвечивает target message только если он уже входит в текущую
              загруженную историю чата или группы.
            </div>
          )}

          {searchStatus === "idle" && (
            <InlineState
              title="Поиск ещё не запускался"
              message="Этот bootstrap intentionally narrow: без ranking redesign, без fuzzy search и без deep history backfill."
            />
          )}

          {searchStatus === "loading" && (
            <InlineState
              title="Ищем сообщения"
              message="Выполняем запрос через существующий SearchMessages API и готовим компактный jump-oriented список."
            />
          )}

          {searchStatus === "error" && (
            <InlineState
              title="Поиск не выполнен"
              message={searchError ?? "Не удалось выполнить поиск сообщений."}
              tone="error"
            />
          )}

          {searchStatus === "ready" && results.length === 0 && (
            <InlineState
              title="Совпадений нет"
              message="Попробуйте скорректировать текст запроса или изменить scope поиска."
            />
          )}

          {results.length > 0 && (
            <>
              <div className={styles.resultList}>
                {results.map((result) => (
                  <article className={styles.resultCard} key={`${result.messageId}-${result.createdAt}`}>
                    <div className={styles.resultHeaderRow}>
                      <div>
                        <div className={styles.badgeRow}>
                          <span className={styles.scopeBadge}>
                            {describeSearchResultScope(result)}
                          </span>
                          {result.editedAt && (
                            <span className={styles.metaBadge}>Изменено</span>
                          )}
                        </div>
                        <h3 className={styles.resultTitle}>
                          {describeSearchResultContainer(
                            result,
                            directChats,
                            groups,
                            currentUserId,
                          )}
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

                    <p className={styles.fragment}>
                      {normalizeMatchFragment(result.matchFragment)}
                    </p>
                  </article>
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
      )}
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
