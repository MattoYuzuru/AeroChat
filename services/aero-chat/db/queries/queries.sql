-- name: GetSessionAuthByID :one
SELECT
    s.id AS session_id,
    s.user_id AS session_user_id,
    s.device_id AS session_device_id,
    s.token_hash,
    s.created_at AS session_created_at,
    s.last_seen_at AS session_last_seen_at,
    s.revoked_at AS session_revoked_at,
    d.id AS device_id,
    d.user_id AS device_user_id,
    d.label AS device_label,
    d.created_at AS device_created_at,
    d.last_seen_at AS device_last_seen_at,
    d.revoked_at AS device_revoked_at,
    u.id AS user_id,
    u.login,
    u.nickname,
    u.avatar_url,
    u.read_receipts_enabled,
    u.presence_enabled,
    u.typing_visibility_enabled,
    u.created_at AS user_created_at,
    u.updated_at AS user_updated_at
FROM user_sessions AS s
JOIN user_devices AS d ON d.id = s.device_id
JOIN users AS u ON u.id = s.user_id
WHERE s.id = $1;

-- name: TouchSessionAndDevice :exec
WITH touched_session AS (
    UPDATE user_sessions AS s
    SET last_seen_at = $3
    WHERE s.id = $1 AND s.device_id = $2
), touched_device AS (
    UPDATE user_devices AS d
    SET last_seen_at = $3
    WHERE d.id = $2
)
SELECT 1;

-- name: FriendshipExists :one
SELECT EXISTS (
    SELECT 1
    FROM user_friendships
    WHERE user_low_id = $1 AND user_high_id = $2
) AS friendship_exists;

-- name: GetDirectChatRelationshipState :one
SELECT
    EXISTS (
        SELECT 1
        FROM user_blocks AS b
        WHERE (b.blocker_user_id = $1 AND b.blocked_user_id = $2)
           OR (b.blocker_user_id = $2 AND b.blocked_user_id = $1)
    ) AS has_block,
    EXISTS (
        SELECT 1
        FROM user_friendships AS f
        WHERE f.user_low_id = $3 AND f.user_high_id = $4
    ) AS are_friends;

-- name: CreateDirectChat :one
INSERT INTO direct_chats (
    id,
    created_by_user_id,
    user_low_id,
    user_high_id,
    created_at,
    updated_at
) VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, created_by_user_id, user_low_id, user_high_id, created_at, updated_at;

-- name: AddDirectChatParticipant :exec
INSERT INTO direct_chat_participants (
    chat_id,
    user_id,
    joined_at
) VALUES ($1, $2, $3);

-- name: ListDirectChatRowsByUserID :many
SELECT
    c.id AS chat_id,
    c.created_by_user_id,
    c.user_low_id,
    c.user_high_id,
    c.created_at AS chat_created_at,
    c.updated_at AS chat_updated_at,
    p.user_id AS participant_user_id,
    u.login AS participant_login,
    u.nickname AS participant_nickname,
    u.avatar_url AS participant_avatar_url
FROM direct_chat_participants AS self
JOIN direct_chats AS c ON c.id = self.chat_id
JOIN direct_chat_participants AS p ON p.chat_id = c.id
JOIN users AS u ON u.id = p.user_id
WHERE self.user_id = $1
ORDER BY c.updated_at DESC, c.id DESC, p.joined_at ASC, p.user_id ASC;

-- name: GetDirectChatRowsByIDAndUserID :many
SELECT
    c.id AS chat_id,
    c.created_by_user_id,
    c.user_low_id,
    c.user_high_id,
    c.created_at AS chat_created_at,
    c.updated_at AS chat_updated_at,
    p.user_id AS participant_user_id,
    u.login AS participant_login,
    u.nickname AS participant_nickname,
    u.avatar_url AS participant_avatar_url
FROM direct_chat_participants AS self
JOIN direct_chats AS c ON c.id = self.chat_id
JOIN direct_chat_participants AS p ON p.chat_id = c.id
JOIN users AS u ON u.id = p.user_id
WHERE self.user_id = $1 AND c.id = $2
ORDER BY p.joined_at ASC, p.user_id ASC;

-- name: ListDirectChatReadStateEntries :many
SELECT
    p.user_id,
    u.read_receipts_enabled,
    r.last_read_message_id,
    r.last_read_message_created_at,
    r.updated_at
FROM direct_chat_participants AS self
JOIN direct_chat_participants AS p ON p.chat_id = self.chat_id
JOIN users AS u ON u.id = p.user_id
LEFT JOIN direct_chat_read_receipts AS r ON r.chat_id = p.chat_id AND r.user_id = p.user_id
WHERE self.user_id = $1 AND self.chat_id = $2
ORDER BY p.joined_at ASC, p.user_id ASC;

-- name: ListDirectChatTypingStateEntries :many
SELECT
    p.user_id,
    u.typing_visibility_enabled
FROM direct_chat_participants AS self
JOIN direct_chat_participants AS p ON p.chat_id = self.chat_id
JOIN users AS u ON u.id = p.user_id
WHERE self.user_id = $1 AND self.chat_id = $2
ORDER BY p.joined_at ASC, p.user_id ASC;

-- name: ListDirectChatPresenceStateEntries :many
SELECT
    p.user_id,
    u.presence_enabled
FROM direct_chat_participants AS self
JOIN direct_chat_participants AS p ON p.chat_id = self.chat_id
JOIN users AS u ON u.id = p.user_id
WHERE self.user_id = $1 AND self.chat_id = $2
ORDER BY p.joined_at ASC, p.user_id ASC;

-- name: ListPinnedMessageIDsByChatID :many
SELECT message_id
FROM direct_chat_pins
WHERE chat_id = $1
ORDER BY created_at DESC, message_id DESC;

-- name: GetDirectChatMessageByID :one
SELECT
    m.id,
    m.chat_id,
    m.sender_user_id,
    m.kind,
    m.text_content,
    m.markdown_policy,
    m.created_at,
    m.updated_at,
    t.deleted_by_user_id,
    t.deleted_at,
    EXISTS (
        SELECT 1
        FROM direct_chat_pins AS p
        WHERE p.chat_id = m.chat_id AND p.message_id = m.id
    ) AS pinned
FROM direct_chat_messages AS m
JOIN direct_chat_participants AS self ON self.chat_id = m.chat_id
LEFT JOIN direct_chat_message_tombstones AS t ON t.message_id = m.id
WHERE self.user_id = $1 AND m.chat_id = $2 AND m.id = $3;

-- name: ListDirectChatMessages :many
SELECT
    m.id,
    m.chat_id,
    m.sender_user_id,
    m.kind,
    m.text_content,
    m.markdown_policy,
    m.created_at,
    m.updated_at,
    t.deleted_by_user_id,
    t.deleted_at,
    EXISTS (
        SELECT 1
        FROM direct_chat_pins AS p
        WHERE p.chat_id = m.chat_id AND p.message_id = m.id
    ) AS pinned
FROM direct_chat_messages AS m
JOIN direct_chat_participants AS self ON self.chat_id = m.chat_id
LEFT JOIN direct_chat_message_tombstones AS t ON t.message_id = m.id
WHERE self.user_id = $1 AND m.chat_id = $2
ORDER BY m.created_at DESC, m.id DESC
LIMIT $3;

-- name: CreateDirectChatMessage :one
INSERT INTO direct_chat_messages (
    id,
    chat_id,
    sender_user_id,
    kind,
    text_content,
    markdown_policy,
    created_at,
    updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, chat_id, sender_user_id, kind, text_content, markdown_policy, created_at, updated_at;

-- name: TouchDirectChatUpdatedAt :exec
UPDATE direct_chats
SET updated_at = $2
WHERE id = $1;

-- name: TouchDirectChatMessageUpdatedAt :exec
UPDATE direct_chat_messages
SET updated_at = $2
WHERE id = $1;

-- name: UpsertDirectChatReadReceipt :execrows
INSERT INTO direct_chat_read_receipts (
    chat_id,
    user_id,
    last_read_message_id,
    last_read_message_created_at,
    updated_at
) VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (chat_id, user_id) DO UPDATE
SET
    last_read_message_id = EXCLUDED.last_read_message_id,
    last_read_message_created_at = EXCLUDED.last_read_message_created_at,
    updated_at = EXCLUDED.updated_at
WHERE direct_chat_read_receipts.last_read_message_created_at < EXCLUDED.last_read_message_created_at
   OR (
        direct_chat_read_receipts.last_read_message_created_at = EXCLUDED.last_read_message_created_at
        AND direct_chat_read_receipts.last_read_message_id < EXCLUDED.last_read_message_id
   );

-- name: CreateDirectChatMessageTombstone :execrows
INSERT INTO direct_chat_message_tombstones (
    message_id,
    chat_id,
    deleted_by_user_id,
    deleted_at
) VALUES ($1, $2, $3, $4)
ON CONFLICT (message_id) DO NOTHING;

-- name: PinDirectChatMessage :execrows
INSERT INTO direct_chat_pins (
    chat_id,
    message_id,
    pinned_by_user_id,
    created_at
) VALUES ($1, $2, $3, $4)
ON CONFLICT (chat_id, message_id) DO NOTHING;

-- name: UnpinDirectChatMessage :execrows
DELETE FROM direct_chat_pins
WHERE chat_id = $1 AND message_id = $2;
