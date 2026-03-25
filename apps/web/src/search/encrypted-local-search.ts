import {
  encryptedDirectMessageV2ProjectionLimit,
  mergeEncryptedDirectMessageV2Projection,
  type EncryptedDirectMessageV2ProjectionEntry,
} from "../chats/encrypted-v2-projection";
import {
  discardBufferedLocalEncryptedDirectMessageV2Projection,
  listBufferedLocalEncryptedDirectMessageV2Projection,
} from "../chats/encrypted-v2-local-outbound";
import {
  listBufferedEncryptedDirectMessageV2RealtimeEvents,
} from "../chats/encrypted-v2-realtime";
import type { CryptoRuntimeContextValue } from "../crypto/runtime-context";
import { resolveActiveRealtimeCryptoDeviceId } from "../crypto/realtime-bridge-helpers";
import type { EncryptedGroupDecryptedEnvelope } from "../crypto/types";
import { gatewayClient } from "../gateway/runtime";
import type {
  ChatUser,
  DirectChat,
  EncryptedDirectMessageV2Envelope,
  EncryptedGroupBootstrap,
  EncryptedGroupEnvelope,
  Group,
} from "../gateway/types";
import {
  encryptedGroupProjectionLimit,
  mergeEncryptedGroupProjection,
  type EncryptedGroupProjectionEntry,
} from "../groups/encrypted-group-projection";
import {
  discardBufferedLocalEncryptedGroupProjection,
  listBufferedLocalEncryptedGroupProjection,
} from "../groups/encrypted-group-local-outbound";
import { listBufferedEncryptedGroupRealtimeEvents } from "../groups/encrypted-group-realtime";
import type { SearchScopeSelection } from "./model";

export const encryptedLocalSearchLaneMessageLimit = Math.min(
  encryptedDirectMessageV2ProjectionLimit,
  encryptedGroupProjectionLimit,
);
export const encryptedLocalSearchAllScopeLaneLimit = 12;
export const encryptedLocalSearchCacheLaneLimit = 32;

export interface EncryptedLocalSearchResult {
  lane: "encrypted";
  scope: "direct" | "group";
  directChatId: string | null;
  groupId: string | null;
  groupThreadId: string | null;
  messageId: string;
  author: ChatUser | null;
  createdAt: string;
  editedAt: string | null;
  matchFragment: string;
  position: {
    messageId: string;
    messageCreatedAt: string;
  };
}

export interface EncryptedLocalSearchSummary {
  availableLaneCount: number;
  searchedLaneCount: number;
  indexedMessageCount: number;
  failedLaneCount: number;
  laneMessageLimit: number;
  laneLimit: number;
  cacheLaneLimit: number;
  limitedByLaneBudget: boolean;
  mode: "session_local_memory";
}

export interface EncryptedLocalSearchResponse {
  status: "ready" | "unavailable";
  results: EncryptedLocalSearchResult[];
  summary: EncryptedLocalSearchSummary;
  errorMessage: string | null;
}

interface EncryptedLocalIndexedMessage {
  lane: "encrypted";
  scope: "direct" | "group";
  directChatId: string | null;
  groupId: string | null;
  groupThreadId: string | null;
  messageId: string;
  author: ChatUser | null;
  createdAt: string;
  editedAt: string | null;
  text: string;
}

interface EncryptedLocalSearchLaneCacheEntry {
  key: string;
  scope: "direct" | "group";
  directChatId: string | null;
  groupId: string | null;
  groupThreadId: string | null;
  entityUpdatedAt: string;
  indexedAtSequence: number;
  indexedMessages: EncryptedLocalIndexedMessage[];
}

const encryptedLocalSearchLaneCache = new Map<string, EncryptedLocalSearchLaneCacheEntry>();
let encryptedLocalSearchSequence = 0;

export function clearEncryptedLocalSearchIndex() {
  encryptedLocalSearchLaneCache.clear();
  encryptedLocalSearchSequence = 0;
}

export function primeEncryptedDirectLocalSearchIndex(input: {
  chat: DirectChat;
  items: EncryptedDirectMessageV2ProjectionEntry[];
}) {
  storeLaneCacheEntry({
    key: buildDirectLaneKey(input.chat.id),
    scope: "direct",
    directChatId: input.chat.id,
    groupId: null,
    groupThreadId: null,
    entityUpdatedAt: input.chat.updatedAt,
    indexedMessages: input.items.flatMap((item) =>
      buildIndexedMessagesFromEncryptedDirectEntry(item, input.chat.participants),
    ),
  });
}

export function primeEncryptedGroupLocalSearchIndex(input: {
  group: Group;
  bootstrap: EncryptedGroupBootstrap | null;
  items: EncryptedGroupProjectionEntry[];
}) {
  const authors = input.bootstrap?.rosterMembers.map((member) => member.user) ?? [];
  const threadId = input.bootstrap?.lane.threadId ?? null;

  storeLaneCacheEntry({
    key: buildGroupLaneKey(input.group.id),
    scope: "group",
    directChatId: null,
    groupId: input.group.id,
    groupThreadId: threadId,
    entityUpdatedAt: input.group.updatedAt,
    indexedMessages: input.items.flatMap((item) =>
      buildIndexedMessagesFromEncryptedGroupEntry(item, authors, threadId),
    ),
  });
}

export function queryEncryptedLocalSearchIndex(input: {
  query: string;
  scopeSelection: SearchScopeSelection;
  directChats: DirectChat[];
  groups: Group[];
  directChatId: string;
  groupId: string;
}): EncryptedLocalSearchResponse {
  const laneSelection = selectSearchLanes({
    scopeSelection: input.scopeSelection,
    directChats: input.directChats,
    groups: input.groups,
    directChatId: input.directChatId,
    groupId: input.groupId,
  });
  const queryDescriptor = buildQueryDescriptor(input.query);
  const indexedMessages = laneSelection.searchedLanes.flatMap((lane) => {
    const entry = encryptedLocalSearchLaneCache.get(lane.key);
    return entry?.indexedMessages ?? [];
  });

  return {
    status: "ready",
    results: indexedMessages
      .flatMap((message) => buildResultIfMatched(message, queryDescriptor))
      .sort(compareEncryptedLocalSearchResults),
    summary: {
      availableLaneCount: laneSelection.availableLaneCount,
      searchedLaneCount: laneSelection.searchedLanes.length,
      indexedMessageCount: indexedMessages.length,
      failedLaneCount: 0,
      laneMessageLimit: encryptedLocalSearchLaneMessageLimit,
      laneLimit: encryptedLocalSearchAllScopeLaneLimit,
      cacheLaneLimit: encryptedLocalSearchCacheLaneLimit,
      limitedByLaneBudget: laneSelection.limitedByLaneBudget,
      mode: "session_local_memory",
    },
    errorMessage: null,
  };
}

export async function searchEncryptedLocalMessages(input: {
  query: string;
  scopeSelection: SearchScopeSelection;
  directChats: DirectChat[];
  groups: Group[];
  directChatId: string;
  groupId: string;
  token: string;
  cryptoRuntime: CryptoRuntimeContextValue;
}): Promise<EncryptedLocalSearchResponse> {
  // Encrypted lanes сознательно не используют backend SearchMessages:
  // server-side parity остаётся legacy plaintext-only, а encrypted search живёт только локально.
  const activeCryptoDeviceId = resolveActiveRealtimeCryptoDeviceId(input.cryptoRuntime.state);
  if (activeCryptoDeviceId === null) {
    return {
      status: "unavailable",
      results: [],
      summary: emptyEncryptedLocalSearchSummary(),
      errorMessage:
        input.cryptoRuntime.state.snapshot?.errorMessage ??
        "Текущий browser profile ещё не готов к local encrypted search.",
    };
  }

  const laneSelection = selectSearchLanes({
    scopeSelection: input.scopeSelection,
    directChats: input.directChats,
    groups: input.groups,
    directChatId: input.directChatId,
    groupId: input.groupId,
  });
  const staleLanes = laneSelection.searchedLanes.filter((lane) =>
    isLaneStale(lane.key, lane.entityUpdatedAt),
  );

  const loadResults = await Promise.allSettled(
    staleLanes.map((lane) =>
      lane.scope === "direct"
        ? loadEncryptedDirectSearchLane({
            token: input.token,
            chat: lane.chat,
            activeCryptoDeviceId,
            cryptoRuntime: input.cryptoRuntime,
          })
        : loadEncryptedGroupSearchLane({
            token: input.token,
            group: lane.group,
            activeCryptoDeviceId,
            cryptoRuntime: input.cryptoRuntime,
          }),
    ),
  );

  const failedLaneCount = loadResults.filter((result) => result.status === "rejected").length;
  const queryDescriptor = buildQueryDescriptor(input.query);
  const indexedMessages = laneSelection.searchedLanes.flatMap((lane) => {
    const entry = encryptedLocalSearchLaneCache.get(lane.key);
    return entry?.indexedMessages ?? [];
  });

  return {
    status: "ready",
    results: indexedMessages
      .flatMap((message) => buildResultIfMatched(message, queryDescriptor))
      .sort(compareEncryptedLocalSearchResults),
    summary: {
      availableLaneCount: laneSelection.availableLaneCount,
      searchedLaneCount: laneSelection.searchedLanes.length,
      indexedMessageCount: indexedMessages.length,
      failedLaneCount,
      laneMessageLimit: encryptedLocalSearchLaneMessageLimit,
      laneLimit: encryptedLocalSearchAllScopeLaneLimit,
      cacheLaneLimit: encryptedLocalSearchCacheLaneLimit,
      limitedByLaneBudget: laneSelection.limitedByLaneBudget,
      mode: "session_local_memory",
    },
    errorMessage:
      failedLaneCount > 0
        ? "Часть encrypted conversations не удалось локально подготовить для поиска в этом запросе."
        : null,
  };
}

function emptyEncryptedLocalSearchSummary(): EncryptedLocalSearchSummary {
  return {
    availableLaneCount: 0,
    searchedLaneCount: 0,
    indexedMessageCount: 0,
    failedLaneCount: 0,
    laneMessageLimit: encryptedLocalSearchLaneMessageLimit,
    laneLimit: encryptedLocalSearchAllScopeLaneLimit,
    cacheLaneLimit: encryptedLocalSearchCacheLaneLimit,
    limitedByLaneBudget: false,
    mode: "session_local_memory",
  };
}

function storeLaneCacheEntry(input: Omit<EncryptedLocalSearchLaneCacheEntry, "indexedAtSequence">) {
  encryptedLocalSearchLaneCache.set(input.key, {
    ...input,
    indexedAtSequence: ++encryptedLocalSearchSequence,
  });
  trimLaneCache();
}

function trimLaneCache() {
  for (; encryptedLocalSearchLaneCache.size > encryptedLocalSearchCacheLaneLimit; ) {
    let oldestKey: string | null = null;
    let oldestSequence = Number.POSITIVE_INFINITY;

    for (const [key, entry] of encryptedLocalSearchLaneCache.entries()) {
      if (entry.indexedAtSequence < oldestSequence) {
        oldestSequence = entry.indexedAtSequence;
        oldestKey = key;
      }
    }

    if (oldestKey === null) {
      return;
    }

    encryptedLocalSearchLaneCache.delete(oldestKey);
  }
}

function isLaneStale(key: string, entityUpdatedAt: string): boolean {
  const cached = encryptedLocalSearchLaneCache.get(key);
  if (!cached) {
    return true;
  }

  if (entityUpdatedAt.trim() === "") {
    return false;
  }

  return cached.entityUpdatedAt < entityUpdatedAt;
}

async function loadEncryptedDirectSearchLane(input: {
  token: string;
  chat: DirectChat;
  activeCryptoDeviceId: string;
  cryptoRuntime: CryptoRuntimeContextValue;
}) {
  const envelopes = await gatewayClient.listEncryptedDirectMessageV2(
    input.token,
    input.chat.id,
    input.activeCryptoDeviceId,
    encryptedLocalSearchLaneMessageLimit,
  );
  const bufferedRealtime = listBufferedEncryptedDirectMessageV2RealtimeEvents()
    .map((event) => event.envelope)
    .filter(
      (envelope) =>
        envelope.chatId === input.chat.id &&
        envelope.viewerDelivery.recipientCryptoDeviceId === input.activeCryptoDeviceId,
    );
  const mergedOpaqueEnvelopes = deduplicateEncryptedDirectEnvelopes([
    ...envelopes,
    ...bufferedRealtime,
  ]);

  discardBufferedLocalEncryptedDirectMessageV2Projection(
    mergedOpaqueEnvelopes.map((envelope) => ({
      chatId: envelope.chatId,
      messageId: envelope.messageId,
      revision: envelope.revision,
    })),
  );

  const decrypted = await input.cryptoRuntime.decryptEncryptedDirectMessageV2Envelopes(
    mergedOpaqueEnvelopes,
  );
  const localOutbound = listBufferedLocalEncryptedDirectMessageV2Projection(input.chat.id);

  const items = mergeEncryptedDirectMessageV2Projection([], [...decrypted, ...localOutbound]);
  primeEncryptedDirectLocalSearchIndex({
    chat: input.chat,
    items,
  });
}

async function loadEncryptedGroupSearchLane(input: {
  token: string;
  group: Group;
  activeCryptoDeviceId: string;
  cryptoRuntime: CryptoRuntimeContextValue;
}) {
  const envelopes = await gatewayClient.listEncryptedGroupMessages(
    input.token,
    input.group.id,
    input.activeCryptoDeviceId,
    encryptedLocalSearchLaneMessageLimit,
  );
  const bufferedRealtime = listBufferedEncryptedGroupRealtimeEvents()
    .map((event) => event.envelope)
    .filter(
      (envelope) =>
        envelope.groupId === input.group.id &&
        envelope.viewerDelivery.recipientCryptoDeviceId === input.activeCryptoDeviceId,
    );
  const mergedOpaqueEnvelopes = deduplicateEncryptedGroupEnvelopes([
    ...envelopes,
    ...bufferedRealtime,
  ]);

  discardBufferedLocalEncryptedGroupProjection(
    mergedOpaqueEnvelopes.map((envelope) => ({
      groupId: envelope.groupId,
      messageId: envelope.messageId,
      revision: envelope.revision,
    })),
  );

  const [bootstrapResult, decryptedResult] = await Promise.allSettled([
    mergedOpaqueEnvelopes.length > 0
      ? gatewayClient.getEncryptedGroupBootstrap(
          input.token,
          input.group.id,
          input.activeCryptoDeviceId,
        )
      : Promise.resolve<EncryptedGroupBootstrap | null>(null),
    input.cryptoRuntime.decryptEncryptedGroupEnvelopes(mergedOpaqueEnvelopes),
  ]);
  const decrypted =
    decryptedResult.status === "fulfilled" ? decryptedResult.value : ([] as EncryptedGroupDecryptedEnvelope[]);
  const localOutbound = listBufferedLocalEncryptedGroupProjection(input.group.id);
  const items = mergeEncryptedGroupProjection([], [...decrypted, ...localOutbound]);

  primeEncryptedGroupLocalSearchIndex({
    group: input.group,
    bootstrap:
      bootstrapResult.status === "fulfilled"
        ? bootstrapResult.value
        : null,
    items,
  });
}

function selectSearchLanes(input: {
  scopeSelection: SearchScopeSelection;
  directChats: DirectChat[];
  groups: Group[];
  directChatId: string;
  groupId: string;
}): {
  availableLaneCount: number;
  searchedLanes: SearchLaneDescriptor[];
  limitedByLaneBudget: boolean;
} {
  if (input.scopeSelection === "direct") {
    const chat = input.directChats.find((entry) => entry.id === input.directChatId) ?? null;
    return {
      availableLaneCount: chat ? 1 : 0,
      searchedLanes: chat ? [{ key: buildDirectLaneKey(chat.id), scope: "direct", chat, entityUpdatedAt: chat.updatedAt }] : [],
      limitedByLaneBudget: false,
    };
  }

  if (input.scopeSelection === "group") {
    const group = input.groups.find((entry) => entry.id === input.groupId) ?? null;
    return {
      availableLaneCount: group ? 1 : 0,
      searchedLanes: group ? [{ key: buildGroupLaneKey(group.id), scope: "group", group, entityUpdatedAt: group.updatedAt }] : [],
      limitedByLaneBudget: false,
    };
  }

  if (input.scopeSelection === "all-direct") {
    const sorted = [...input.directChats].sort(compareEntitiesByUpdatedAt).slice(
      0,
      encryptedLocalSearchAllScopeLaneLimit,
    );
    return {
      availableLaneCount: input.directChats.length,
      searchedLanes: sorted.map((chat) => ({
        key: buildDirectLaneKey(chat.id),
        scope: "direct",
        chat,
        entityUpdatedAt: chat.updatedAt,
      })),
      limitedByLaneBudget: input.directChats.length > sorted.length,
    };
  }

  const sorted = [...input.groups].sort(compareEntitiesByUpdatedAt).slice(
    0,
    encryptedLocalSearchAllScopeLaneLimit,
  );
  return {
    availableLaneCount: input.groups.length,
    searchedLanes: sorted.map((group) => ({
      key: buildGroupLaneKey(group.id),
      scope: "group",
      group,
      entityUpdatedAt: group.updatedAt,
    })),
    limitedByLaneBudget: input.groups.length > sorted.length,
  };
}

interface BaseSearchLaneDescriptor {
  key: string;
  entityUpdatedAt: string;
}

type DirectSearchLaneDescriptor = BaseSearchLaneDescriptor & {
  scope: "direct";
  chat: DirectChat;
};

type GroupSearchLaneDescriptor = BaseSearchLaneDescriptor & {
  scope: "group";
  group: Group;
};

type SearchLaneDescriptor = DirectSearchLaneDescriptor | GroupSearchLaneDescriptor;

function compareEntitiesByUpdatedAt(
  left: Pick<DirectChat | Group, "updatedAt" | "id">,
  right: Pick<DirectChat | Group, "updatedAt" | "id">,
) {
  if (left.updatedAt === right.updatedAt) {
    return right.id.localeCompare(left.id);
  }

  return right.updatedAt.localeCompare(left.updatedAt);
}

function buildIndexedMessagesFromEncryptedDirectEntry(
  item: EncryptedDirectMessageV2ProjectionEntry,
  participants: ChatUser[],
): EncryptedLocalIndexedMessage[] {
  if (item.kind !== "message" || item.isTombstone || item.text === null || item.text.trim() === "") {
    return [];
  }

  return [
    {
      lane: "encrypted",
      scope: "direct",
      directChatId: item.chatId,
      groupId: null,
      groupThreadId: null,
      messageId: item.messageId,
      author: participants.find((participant) => participant.id === item.senderUserId) ?? null,
      createdAt: item.createdAt,
      editedAt: item.editedAt,
      text: item.text,
    },
  ];
}

function buildIndexedMessagesFromEncryptedGroupEntry(
  item: EncryptedGroupProjectionEntry,
  authors: ChatUser[],
  groupThreadId: string | null,
): EncryptedLocalIndexedMessage[] {
  if (item.kind !== "message" || item.isTombstone || item.text === null || item.text.trim() === "") {
    return [];
  }

  return [
    {
      lane: "encrypted",
      scope: "group",
      directChatId: null,
      groupId: item.groupId,
      groupThreadId: groupThreadId ?? item.threadId,
      messageId: item.messageId,
      author: authors.find((author) => author.id === item.senderUserId) ?? null,
      createdAt: item.createdAt,
      editedAt: item.editedAt,
      text: item.text,
    },
  ];
}

function buildResultIfMatched(
  message: EncryptedLocalIndexedMessage,
  queryDescriptor: QueryDescriptor,
): EncryptedLocalSearchResult[] {
  const normalizedText = normalizeForSearch(message.text);
  if (!matchesQuery(normalizedText, queryDescriptor)) {
    return [];
  }

  return [
    {
      lane: "encrypted",
      scope: message.scope,
      directChatId: message.directChatId,
      groupId: message.groupId,
      groupThreadId: message.groupThreadId,
      messageId: message.messageId,
      author: message.author,
      createdAt: message.createdAt,
      editedAt: message.editedAt,
      matchFragment: buildMatchFragment(message.text, queryDescriptor),
      position: {
        messageId: message.messageId,
        messageCreatedAt: message.createdAt,
      },
    },
  ];
}

function compareEncryptedLocalSearchResults(
  left: EncryptedLocalSearchResult,
  right: EncryptedLocalSearchResult,
) {
  if (left.createdAt === right.createdAt) {
    return right.messageId.localeCompare(left.messageId);
  }

  return right.createdAt.localeCompare(left.createdAt);
}

interface QueryDescriptor {
  normalizedQuery: string;
  terms: string[];
}

function buildQueryDescriptor(query: string): QueryDescriptor {
  const normalizedQuery = normalizeForSearch(query);
  const terms = normalizedQuery
    .split(" ")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    normalizedQuery,
    terms,
  };
}

function matchesQuery(text: string, query: QueryDescriptor): boolean {
  if (query.normalizedQuery === "") {
    return false;
  }

  if (text.includes(query.normalizedQuery)) {
    return true;
  }

  return query.terms.length > 0 && query.terms.every((term) => text.includes(term));
}

function buildMatchFragment(text: string, query: QueryDescriptor): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact === "") {
    return "Локальный fragment недоступен.";
  }

  const focus = query.terms.find((term) => term !== "") ?? query.normalizedQuery;
  const normalizedCompact = normalizeForSearch(compact);
  const matchIndex = focus === "" ? -1 : normalizedCompact.indexOf(focus);

  if (matchIndex < 0) {
    return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
  }

  const start = Math.max(0, matchIndex - 64);
  const end = Math.min(compact.length, matchIndex + focus.length + 96);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < compact.length ? "..." : "";

  return `${prefix}${compact.slice(start, end).trim()}${suffix}`;
}

function normalizeForSearch(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
}

function buildDirectLaneKey(chatId: string): string {
  return `direct:${chatId}`;
}

function buildGroupLaneKey(groupId: string): string {
  return `group:${groupId}`;
}

function deduplicateEncryptedDirectEnvelopes(
  envelopes: EncryptedDirectMessageV2Envelope[],
): EncryptedDirectMessageV2Envelope[] {
  const deduplicated = new Map<string, EncryptedDirectMessageV2Envelope>();
  for (const envelope of envelopes) {
    deduplicated.set(
      [
        envelope.messageId,
        envelope.revision,
        envelope.viewerDelivery.recipientCryptoDeviceId,
        envelope.storedAt,
      ].join(":"),
      envelope,
    );
  }

  return Array.from(deduplicated.values()).sort(compareEncryptedEnvelopes);
}

function deduplicateEncryptedGroupEnvelopes(
  envelopes: EncryptedGroupEnvelope[],
): EncryptedGroupEnvelope[] {
  const deduplicated = new Map<string, EncryptedGroupEnvelope>();
  for (const envelope of envelopes) {
    deduplicated.set(
      [
        envelope.messageId,
        envelope.revision,
        envelope.viewerDelivery.recipientCryptoDeviceId,
        envelope.storedAt,
      ].join(":"),
      envelope,
    );
  }

  return Array.from(deduplicated.values()).sort(compareEncryptedEnvelopes);
}

function compareEncryptedEnvelopes(
  left: Pick<EncryptedDirectMessageV2Envelope | EncryptedGroupEnvelope, "createdAt" | "messageId">,
  right: Pick<EncryptedDirectMessageV2Envelope | EncryptedGroupEnvelope, "createdAt" | "messageId">,
) {
  if (left.createdAt === right.createdAt) {
    return left.messageId.localeCompare(right.messageId);
  }

  return left.createdAt.localeCompare(right.createdAt);
}
