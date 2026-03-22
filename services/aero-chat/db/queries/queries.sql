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
    COALESCE((
        SELECT COUNT(*)::INT
        FROM direct_chat_messages AS m
        LEFT JOIN direct_chat_message_tombstones AS t ON t.message_id = m.id
        LEFT JOIN direct_chat_read_receipts AS self_receipt
            ON self_receipt.chat_id = c.id AND self_receipt.user_id = self.user_id
        WHERE m.chat_id = c.id
          AND t.message_id IS NULL
          AND m.sender_user_id <> self.user_id
          AND (
              self_receipt.last_read_message_id IS NULL
              OR m.created_at > self_receipt.last_read_message_created_at
              OR (
                  m.created_at = self_receipt.last_read_message_created_at
                  AND m.id > self_receipt.last_read_message_id
              )
          )
    ), 0)::INT AS unread_count,
    COALESCE((
        SELECT COUNT(*)::INT
        FROM direct_chat_encrypted_messages_v2 AS m
        LEFT JOIN direct_chat_encrypted_read_states_v1 AS self_read
            ON self_read.chat_id = c.id AND self_read.user_id = self.user_id
        WHERE m.chat_id = c.id
          AND m.operation_kind = 'content'
          AND m.sender_user_id <> self.user_id
          AND (
              self_read.last_read_message_id IS NULL
              OR m.created_at > self_read.last_read_message_created_at
              OR (
                  m.created_at = self_read.last_read_message_created_at
                  AND m.id > self_read.last_read_message_id
              )
          )
    ), 0)::INT AS encrypted_unread_count,
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
    COALESCE((
        SELECT COUNT(*)::INT
        FROM direct_chat_messages AS m
        LEFT JOIN direct_chat_message_tombstones AS t ON t.message_id = m.id
        LEFT JOIN direct_chat_read_receipts AS self_receipt
            ON self_receipt.chat_id = c.id AND self_receipt.user_id = self.user_id
        WHERE m.chat_id = c.id
          AND t.message_id IS NULL
          AND m.sender_user_id <> self.user_id
          AND (
              self_receipt.last_read_message_id IS NULL
              OR m.created_at > self_receipt.last_read_message_created_at
              OR (
                  m.created_at = self_receipt.last_read_message_created_at
                  AND m.id > self_receipt.last_read_message_id
              )
          )
    ), 0)::INT AS unread_count,
    COALESCE((
        SELECT COUNT(*)::INT
        FROM direct_chat_encrypted_messages_v2 AS m
        LEFT JOIN direct_chat_encrypted_read_states_v1 AS self_read
            ON self_read.chat_id = c.id AND self_read.user_id = self.user_id
        WHERE m.chat_id = c.id
          AND m.operation_kind = 'content'
          AND m.sender_user_id <> self.user_id
          AND (
              self_read.last_read_message_id IS NULL
              OR m.created_at > self_read.last_read_message_created_at
              OR (
                  m.created_at = self_read.last_read_message_created_at
                  AND m.id > self_read.last_read_message_id
              )
          )
    ), 0)::INT AS encrypted_unread_count,
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

-- name: CreateGroup :one
INSERT INTO groups (
    id,
    name,
    created_by_user_id,
    created_at,
    updated_at
) VALUES ($1, $2, $3, $4, $5)
RETURNING id, name, created_by_user_id, created_at, updated_at;

-- name: AddGroupMembership :exec
INSERT INTO group_memberships (
    group_id,
    user_id,
    role,
    joined_at
) VALUES ($1, $2, $3, $4);

-- name: CreateGroupThread :one
INSERT INTO group_threads (
    id,
    group_id,
    thread_key,
    created_at,
    updated_at
) VALUES ($1, $2, $3, $4, $5)
RETURNING id, group_id, thread_key, created_at, updated_at;

-- name: JoinGroupMembership :execrows
INSERT INTO group_memberships (
    group_id,
    user_id,
    role,
    joined_at
) VALUES ($1, $2, $3, $4)
ON CONFLICT (group_id, user_id) DO NOTHING;

-- name: LockGroupByID :one
SELECT id
FROM groups
WHERE id = $1
FOR UPDATE;

-- name: LockGroupMembershipQuotaOwner :one
SELECT id
FROM users
WHERE id = $1
FOR UPDATE;

-- name: GetActiveGroupMembershipCountByUserID :one
SELECT COUNT(*)::BIGINT AS active_membership_count
FROM group_memberships
WHERE user_id = $1;

-- name: ListGroupRowsByUserID :many
SELECT
    g.id,
    g.name,
    g.created_by_user_id,
    self.role AS self_role,
    self.is_write_restricted AS self_is_write_restricted,
    g.created_at,
    g.updated_at,
    COALESCE((
        SELECT COUNT(*)::INT
        FROM group_threads AS primary_thread
        JOIN group_messages AS gm ON gm.thread_id = primary_thread.id
        LEFT JOIN group_chat_read_states AS self_read
            ON self_read.group_id = g.id AND self_read.user_id = self.user_id
        WHERE primary_thread.group_id = g.id
          AND primary_thread.thread_key = 'primary'
          AND gm.sender_user_id <> self.user_id
          AND (
              self_read.last_read_message_id IS NULL
              OR gm.created_at > self_read.last_read_message_created_at
              OR (
                  gm.created_at = self_read.last_read_message_created_at
                  AND gm.id > self_read.last_read_message_id
              )
          )
    ), 0)::INT AS unread_count,
    COALESCE((
        SELECT COUNT(*)::INT
        FROM group_encrypted_messages_v1 AS gm
        LEFT JOIN group_encrypted_read_states_v1 AS self_read
            ON self_read.group_id = g.id AND self_read.user_id = self.user_id
        WHERE gm.group_id = g.id
          AND gm.operation_kind = 'content'
          AND gm.sender_user_id <> self.user_id
          AND (
              self_read.last_read_message_id IS NULL
              OR gm.created_at > self_read.last_read_message_created_at
              OR (
                  gm.created_at = self_read.last_read_message_created_at
                  AND gm.id > self_read.last_read_message_id
              )
          )
    ), 0)::INT AS encrypted_unread_count,
    COALESCE((
        SELECT COUNT(*)::INT
        FROM group_memberships AS members
        WHERE members.group_id = g.id
    ), 0)::INT AS member_count
FROM group_memberships AS self
JOIN groups AS g ON g.id = self.group_id
WHERE self.user_id = $1
ORDER BY g.updated_at DESC, g.id DESC;

-- name: GetGroupRowByIDAndUserID :one
SELECT
    g.id,
    g.name,
    g.created_by_user_id,
    self.role AS self_role,
    self.is_write_restricted AS self_is_write_restricted,
    g.created_at,
    g.updated_at,
    COALESCE((
        SELECT COUNT(*)::INT
        FROM group_threads AS primary_thread
        JOIN group_messages AS gm ON gm.thread_id = primary_thread.id
        LEFT JOIN group_chat_read_states AS self_read
            ON self_read.group_id = g.id AND self_read.user_id = self.user_id
        WHERE primary_thread.group_id = g.id
          AND primary_thread.thread_key = 'primary'
          AND gm.sender_user_id <> self.user_id
          AND (
              self_read.last_read_message_id IS NULL
              OR gm.created_at > self_read.last_read_message_created_at
              OR (
                  gm.created_at = self_read.last_read_message_created_at
                  AND gm.id > self_read.last_read_message_id
              )
          )
    ), 0)::INT AS unread_count,
    COALESCE((
        SELECT COUNT(*)::INT
        FROM group_encrypted_messages_v1 AS gm
        LEFT JOIN group_encrypted_read_states_v1 AS self_read
            ON self_read.group_id = g.id AND self_read.user_id = self.user_id
        WHERE gm.group_id = g.id
          AND gm.operation_kind = 'content'
          AND gm.sender_user_id <> self.user_id
          AND (
              self_read.last_read_message_id IS NULL
              OR gm.created_at > self_read.last_read_message_created_at
              OR (
                  gm.created_at = self_read.last_read_message_created_at
                  AND gm.id > self_read.last_read_message_id
              )
          )
    ), 0)::INT AS encrypted_unread_count,
    COALESCE((
        SELECT COUNT(*)::INT
        FROM group_memberships AS members
        WHERE members.group_id = g.id
    ), 0)::INT AS member_count
FROM group_memberships AS self
JOIN groups AS g ON g.id = self.group_id
WHERE self.user_id = $1 AND g.id = $2;

-- name: GetGroupChatThreadRowByGroupIDAndUserID :one
SELECT
    t.id,
    t.group_id,
    t.thread_key,
    t.created_at,
    t.updated_at
FROM group_memberships AS self
JOIN group_threads AS t ON t.group_id = self.group_id
WHERE self.user_id = $1
  AND self.group_id = $2
  AND t.thread_key = 'primary';

-- name: ListGroupMemberRowsByGroupIDAndUserID :many
SELECT
    m.group_id,
    m.user_id,
    m.role,
    m.is_write_restricted,
    m.write_restricted_at,
    m.joined_at,
    u.login,
    u.nickname,
    u.avatar_url
FROM group_memberships AS self
JOIN group_memberships AS m ON m.group_id = self.group_id
JOIN users AS u ON u.id = m.user_id
WHERE self.user_id = $1 AND self.group_id = $2
ORDER BY
    CASE m.role
        WHEN 'owner' THEN 0
        WHEN 'admin' THEN 1
        WHEN 'member' THEN 2
        WHEN 'reader' THEN 3
        ELSE 4
    END,
    m.joined_at ASC,
    m.user_id ASC;

-- name: GetGroupMemberRowByGroupIDAndUserID :one
SELECT
    m.group_id,
    m.user_id,
    m.role,
    m.is_write_restricted,
    m.write_restricted_at,
    m.joined_at,
    u.login,
    u.nickname,
    u.avatar_url
FROM group_memberships AS m
JOIN users AS u ON u.id = m.user_id
WHERE m.group_id = $1 AND m.user_id = $2;

-- name: UpdateGroupMembershipRole :execrows
UPDATE group_memberships
SET role = $3
WHERE group_id = $1 AND user_id = $2 AND role <> $3;

-- name: SetGroupMembershipWriteRestriction :execrows
UPDATE group_memberships
SET
    is_write_restricted = $3,
    write_restricted_at = CASE WHEN $3 THEN $4 ELSE NULL END
WHERE group_id = $1
  AND user_id = $2
  AND (
      is_write_restricted IS DISTINCT FROM $3
      OR write_restricted_at IS DISTINCT FROM CASE WHEN $3 THEN $4 ELSE NULL END
  );

-- name: TransferGroupOwnership :execrows
UPDATE group_memberships
SET role = CASE
    WHEN user_id = $2 THEN 'admin'
    WHEN user_id = $3 THEN 'owner'
    ELSE role
END
WHERE group_id = $1
  AND user_id IN ($2, $3);

-- name: DeleteGroupMembership :execrows
DELETE FROM group_memberships
WHERE group_id = $1 AND user_id = $2;

-- name: CreateGroupInviteLink :one
INSERT INTO group_invite_links (
    id,
    group_id,
    created_by_user_id,
    role,
    token_hash,
    join_count,
    created_at,
    updated_at
) VALUES ($1, $2, $3, $4, $5, 0, $6, $7)
RETURNING id, group_id, created_by_user_id, role, join_count, created_at, updated_at, disabled_at, last_joined_at;

-- name: ListGroupInviteLinksByGroupID :many
SELECT
    id,
    group_id,
    created_by_user_id,
    role,
    join_count,
    created_at,
    updated_at,
    disabled_at,
    last_joined_at
FROM group_invite_links
WHERE group_id = $1
ORDER BY created_at DESC, id DESC;

-- name: GetGroupInviteLinkByIDAndGroupID :one
SELECT
    id,
    group_id,
    created_by_user_id,
    role,
    join_count,
    created_at,
    updated_at,
    disabled_at,
    last_joined_at
FROM group_invite_links
WHERE group_id = $1 AND id = $2;

-- name: DisableGroupInviteLink :execrows
UPDATE group_invite_links
SET
    disabled_at = $3,
    updated_at = $3
WHERE group_id = $1 AND id = $2 AND disabled_at IS NULL;

-- name: GetGroupInviteLinkForJoin :one
SELECT
    l.id,
    l.group_id,
    l.created_by_user_id,
    l.role,
    l.join_count,
    l.created_at,
    l.updated_at,
    l.disabled_at,
    l.last_joined_at,
    g.name AS group_name,
    g.created_by_user_id AS group_created_by_user_id,
    g.created_at AS group_created_at,
    g.updated_at AS group_updated_at
FROM group_invite_links AS l
JOIN groups AS g ON g.id = l.group_id
WHERE l.token_hash = $1;

-- name: TouchGroupInviteLinkJoin :exec
UPDATE group_invite_links
SET
    join_count = join_count + 1,
    last_joined_at = $2,
    updated_at = $2
WHERE id = $1;

-- name: TouchGroupUpdatedAt :exec
UPDATE groups
SET updated_at = $2
WHERE id = $1;

-- name: ListGroupMessagesByGroupIDAndUserID :many
SELECT
    m.id,
    t.group_id,
    m.thread_id,
    m.sender_user_id,
    m.kind,
    m.text_content,
    m.markdown_policy,
    m.reply_to_message_id,
    m.created_at,
    m.updated_at,
    m.edited_at
FROM group_memberships AS self
JOIN group_threads AS t ON t.group_id = self.group_id
JOIN group_messages AS m ON m.thread_id = t.id
WHERE self.user_id = $1
  AND self.group_id = $2
  AND t.thread_key = 'primary'
ORDER BY m.created_at DESC, m.id DESC
LIMIT $3;

-- name: SearchGroupMessages :many
WITH search_query AS (
    SELECT websearch_to_tsquery('simple', sqlc.arg(query_text)::TEXT) AS query
)
SELECT
    m.id AS message_id,
    t.group_id,
    m.thread_id,
    m.sender_user_id,
    u.login,
    u.nickname,
    u.avatar_url,
    m.created_at,
    m.edited_at,
    COALESCE(
        NULLIF(
            ts_headline(
                'simple',
                m.text_content,
                search_query.query,
                'MaxFragments=2,MaxWords=18,MinWords=8,ShortWord=2,StartSel=,StopSel=,FragmentDelimiter= ... '
            ),
            ''
        ),
        LEFT(m.text_content, 160)
    ) AS match_fragment
FROM group_memberships AS self
JOIN group_threads AS t ON t.group_id = self.group_id
JOIN group_messages AS m ON m.thread_id = t.id
JOIN users AS u ON u.id = m.sender_user_id
CROSS JOIN search_query
WHERE self.user_id = sqlc.arg(user_id)::UUID
  AND t.thread_key = 'primary'
  AND btrim(m.text_content) <> ''
  AND (sqlc.narg(group_id)::UUID IS NULL OR t.group_id = sqlc.narg(group_id)::UUID)
  AND m.search_vector @@ search_query.query
  AND (
      sqlc.narg(cursor_created_at)::TIMESTAMPTZ IS NULL
      OR m.created_at < sqlc.narg(cursor_created_at)::TIMESTAMPTZ
      OR (
          m.created_at = sqlc.narg(cursor_created_at)::TIMESTAMPTZ
          AND m.id < sqlc.narg(cursor_message_id)::UUID
      )
  )
ORDER BY m.created_at DESC, m.id DESC
LIMIT sqlc.arg(limit_count);

-- name: GetGroupMessageByIDAndUserID :one
SELECT
    m.id,
    t.group_id,
    m.thread_id,
    m.sender_user_id,
    m.kind,
    m.text_content,
    m.markdown_policy,
    m.reply_to_message_id,
    m.created_at,
    m.updated_at,
    m.edited_at
FROM group_memberships AS self
JOIN group_threads AS t ON t.group_id = self.group_id
JOIN group_messages AS m ON m.thread_id = t.id
WHERE self.user_id = $1
  AND self.group_id = $2
  AND m.id = $3
  AND t.thread_key = 'primary';

-- name: ListGroupTypingStateEntries :many
SELECT
    m.user_id,
    u.login,
    u.nickname,
    u.avatar_url,
    u.typing_visibility_enabled
FROM group_memberships AS self
JOIN group_memberships AS m ON m.group_id = self.group_id
JOIN users AS u ON u.id = m.user_id
WHERE self.user_id = $1 AND self.group_id = $2
ORDER BY
    CASE m.role
        WHEN 'owner' THEN 0
        WHEN 'admin' THEN 1
        WHEN 'member' THEN 2
        WHEN 'reader' THEN 3
        ELSE 4
    END,
    m.joined_at ASC,
    m.user_id ASC;

-- name: GetGroupReadStateEntryByGroupIDAndUserID :one
SELECT
    self.group_id,
    self.user_id,
    r.last_read_message_id,
    r.last_read_message_created_at,
    r.updated_at
FROM group_memberships AS self
LEFT JOIN group_chat_read_states AS r
    ON r.group_id = self.group_id AND r.user_id = self.user_id
WHERE self.user_id = $1 AND self.group_id = $2;

-- name: GetEncryptedGroupReadStateEntryByGroupIDAndUserID :one
SELECT
    self.group_id,
    self.user_id,
    r.last_read_message_id,
    r.last_read_message_created_at,
    r.updated_at
FROM group_memberships AS self
LEFT JOIN group_encrypted_read_states_v1 AS r
    ON r.group_id = self.group_id AND r.user_id = self.user_id
WHERE self.user_id = $1 AND self.group_id = $2;

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

-- name: ListEncryptedDirectChatReadStateEntries :many
SELECT
    p.user_id,
    u.read_receipts_enabled,
    r.last_read_message_id,
    r.last_read_message_created_at,
    r.updated_at
FROM direct_chat_participants AS self
JOIN direct_chat_participants AS p ON p.chat_id = self.chat_id
JOIN users AS u ON u.id = p.user_id
LEFT JOIN direct_chat_encrypted_read_states_v1 AS r ON r.chat_id = p.chat_id AND r.user_id = p.user_id
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

-- name: ListEncryptedPinnedMessageIDsByChatID :many
SELECT message_id
FROM direct_chat_encrypted_message_pins_v2
WHERE chat_id = $1
ORDER BY created_at DESC, message_id DESC;

-- name: ListEncryptedPinnedMessageIDsByGroupID :many
SELECT message_id
FROM group_encrypted_message_pins_v1
WHERE group_id = $1
ORDER BY created_at DESC, message_id DESC;

-- name: ListDirectReplyPreviewRows :many
SELECT
    m.id,
    m.sender_user_id,
    u.login,
    u.nickname,
    u.avatar_url,
    m.text_content,
    t.deleted_by_user_id,
    t.deleted_at,
    COALESCE((
        SELECT COUNT(*)::INT
        FROM message_attachments AS ma
        WHERE ma.direct_chat_message_id = m.id
    ), 0)::INT AS attachment_count
FROM direct_chat_participants AS self
JOIN direct_chat_messages AS m ON m.chat_id = self.chat_id
JOIN users AS u ON u.id = m.sender_user_id
LEFT JOIN direct_chat_message_tombstones AS t ON t.message_id = m.id
WHERE self.user_id = $1
  AND self.chat_id = $2
  AND m.id = ANY($3::UUID[]);

-- name: GetDirectChatMessageByID :one
SELECT
    m.id,
    m.chat_id,
    m.sender_user_id,
    m.kind,
    m.text_content,
    m.markdown_policy,
    m.reply_to_message_id,
    m.created_at,
    m.updated_at,
    m.edited_at,
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
    m.reply_to_message_id,
    m.created_at,
    m.updated_at,
    m.edited_at,
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

-- name: SearchDirectMessages :many
WITH search_query AS (
    SELECT websearch_to_tsquery('simple', sqlc.arg(query_text)::TEXT) AS query
)
SELECT
    m.id AS message_id,
    m.chat_id,
    m.sender_user_id,
    u.login,
    u.nickname,
    u.avatar_url,
    m.created_at,
    m.edited_at,
    COALESCE(
        NULLIF(
            ts_headline(
                'simple',
                m.text_content,
                search_query.query,
                'MaxFragments=2,MaxWords=18,MinWords=8,ShortWord=2,StartSel=,StopSel=,FragmentDelimiter= ... '
            ),
            ''
        ),
        LEFT(m.text_content, 160)
    ) AS match_fragment
FROM direct_chat_participants AS self
JOIN direct_chat_messages AS m ON m.chat_id = self.chat_id
JOIN users AS u ON u.id = m.sender_user_id
LEFT JOIN direct_chat_message_tombstones AS t ON t.message_id = m.id
CROSS JOIN search_query
WHERE self.user_id = sqlc.arg(user_id)::UUID
  AND t.message_id IS NULL
  AND btrim(m.text_content) <> ''
  AND (sqlc.narg(chat_id)::UUID IS NULL OR m.chat_id = sqlc.narg(chat_id)::UUID)
  AND m.search_vector @@ search_query.query
  AND (
      sqlc.narg(cursor_created_at)::TIMESTAMPTZ IS NULL
      OR m.created_at < sqlc.narg(cursor_created_at)::TIMESTAMPTZ
      OR (
          m.created_at = sqlc.narg(cursor_created_at)::TIMESTAMPTZ
          AND m.id < sqlc.narg(cursor_message_id)::UUID
      )
  )
ORDER BY m.created_at DESC, m.id DESC
LIMIT sqlc.arg(limit_count);

-- name: CreateDirectChatMessage :one
INSERT INTO direct_chat_messages (
    id,
    chat_id,
    sender_user_id,
    kind,
    text_content,
    markdown_policy,
    reply_to_message_id,
    created_at,
    updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id, chat_id, sender_user_id, kind, text_content, markdown_policy, reply_to_message_id, created_at, updated_at, edited_at;

-- name: CreateDirectChatEncryptedMessageV2 :one
INSERT INTO direct_chat_encrypted_messages_v2 (
    id,
    chat_id,
    sender_user_id,
    sender_crypto_device_id,
    operation_kind,
    target_message_id,
    revision,
    created_at,
    stored_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING
    id,
    chat_id,
    sender_user_id,
    sender_crypto_device_id,
    operation_kind,
    target_message_id,
    revision,
    created_at,
    stored_at;

-- name: CreateDirectChatEncryptedMessageV2Delivery :exec
INSERT INTO direct_chat_encrypted_message_deliveries_v2 (
    message_id,
    recipient_user_id,
    recipient_crypto_device_id,
    transport_header,
    ciphertext,
    ciphertext_size_bytes,
    stored_at
) VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: GetEncryptedGroupLaneByGroupID :one
SELECT
    group_id,
    thread_id,
    mls_group_id,
    roster_version,
    activated_at,
    updated_at
FROM group_encrypted_lanes_v1
WHERE group_id = $1;

-- name: ListEncryptedGroupRosterMembersByGroupID :many
SELECT
    group_id,
    user_id,
    role,
    is_write_restricted,
    roster_version,
    created_at,
    updated_at
FROM group_encrypted_roster_members_v1
WHERE group_id = $1
ORDER BY user_id ASC;

-- name: ListEncryptedGroupRosterDevicesByGroupID :many
SELECT
    group_id,
    user_id,
    crypto_device_id,
    roster_version,
    created_at,
    updated_at
FROM group_encrypted_roster_devices_v1
WHERE group_id = $1
ORDER BY user_id ASC, crypto_device_id ASC;

-- name: CreateEncryptedGroupLane :one
INSERT INTO group_encrypted_lanes_v1 (
    group_id,
    thread_id,
    mls_group_id,
    roster_version,
    activated_at,
    updated_at
) VALUES ($1, $2, $3, $4, $5, $6)
RETURNING
    group_id,
    thread_id,
    mls_group_id,
    roster_version,
    activated_at,
    updated_at;

-- name: UpdateEncryptedGroupLane :execrows
UPDATE group_encrypted_lanes_v1
SET
    thread_id = $2,
    roster_version = $3,
    updated_at = $4
WHERE group_id = $1;

-- name: DeleteEncryptedGroupRosterDevicesByGroupID :exec
DELETE FROM group_encrypted_roster_devices_v1
WHERE group_id = $1;

-- name: DeleteEncryptedGroupRosterMembersByGroupID :exec
DELETE FROM group_encrypted_roster_members_v1
WHERE group_id = $1;

-- name: InsertEncryptedGroupRosterMember :exec
INSERT INTO group_encrypted_roster_members_v1 (
    group_id,
    user_id,
    role,
    is_write_restricted,
    roster_version,
    created_at,
    updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: InsertEncryptedGroupRosterDevice :exec
INSERT INTO group_encrypted_roster_devices_v1 (
    group_id,
    user_id,
    crypto_device_id,
    roster_version,
    created_at,
    updated_at
) VALUES ($1, $2, $3, $4, $5, $6);

-- name: CreateEncryptedGroupMessage :one
INSERT INTO group_encrypted_messages_v1 (
    id,
    group_id,
    thread_id,
    mls_group_id,
    roster_version,
    sender_user_id,
    sender_crypto_device_id,
    operation_kind,
    target_message_id,
    revision,
    ciphertext,
    ciphertext_size_bytes,
    created_at,
    stored_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
RETURNING
    id,
    group_id,
    thread_id,
    mls_group_id,
    roster_version,
    sender_user_id,
    sender_crypto_device_id,
    operation_kind,
    target_message_id,
    revision,
    ciphertext_size_bytes,
    created_at,
    stored_at;

-- name: CreateEncryptedGroupMessageDelivery :exec
INSERT INTO group_encrypted_message_deliveries_v1 (
    message_id,
    recipient_user_id,
    recipient_crypto_device_id,
    stored_at
) VALUES ($1, $2, $3, $4);

-- name: CreateAttachment :one
INSERT INTO attachments (
    id,
    owner_user_id,
    scope_kind,
    direct_chat_id,
    group_id,
    bucket_name,
    object_key,
    file_name,
    mime_type,
    relay_schema,
    size_bytes,
    status,
    created_at,
    updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
RETURNING
    id,
    owner_user_id,
    scope_kind,
    direct_chat_id,
    group_id,
    bucket_name,
    object_key,
    file_name,
    mime_type,
    relay_schema,
    size_bytes,
    status,
    created_at,
    updated_at,
    uploaded_at,
    attached_at,
    failed_at,
    deleted_at;

-- name: CreateAttachmentUploadSession :one
INSERT INTO attachment_upload_sessions (
    id,
    attachment_id,
    owner_user_id,
    status,
    expires_at,
    created_at,
    updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING
    id,
    attachment_id,
    owner_user_id,
    status,
    expires_at,
    created_at,
    updated_at,
    completed_at,
    failed_at;

-- name: LockAttachmentQuotaOwner :one
SELECT id
FROM users
WHERE id = $1
FOR UPDATE;

-- name: GetAttachmentQuotaUsageByOwner :one
SELECT COALESCE(SUM(size_bytes), 0)::BIGINT AS total_bytes
FROM attachments
WHERE owner_user_id = $1
  AND status IN ('pending', 'uploaded', 'attached', 'failed');

-- name: GetAttachmentRowByID :one
SELECT
    a.id,
    a.owner_user_id,
    a.scope_kind,
    a.direct_chat_id,
    a.group_id,
    a.bucket_name,
    a.object_key,
    a.file_name,
    a.mime_type,
    a.relay_schema,
    a.size_bytes,
    a.status,
    a.created_at,
    a.updated_at,
    a.uploaded_at,
    a.attached_at,
    a.failed_at,
    a.deleted_at,
    s.id AS upload_session_id,
    s.owner_user_id AS upload_session_owner_user_id,
    s.status AS upload_session_status,
    s.expires_at AS upload_session_expires_at,
    s.created_at AS upload_session_created_at,
    s.updated_at AS upload_session_updated_at,
    s.completed_at AS upload_session_completed_at,
    s.failed_at AS upload_session_failed_at,
    ma.direct_chat_message_id,
    ma.group_message_id,
    ma.encrypted_direct_message_v2_id,
    ma.encrypted_group_message_v1_id
FROM attachments AS a
LEFT JOIN attachment_upload_sessions AS s ON s.attachment_id = a.id
LEFT JOIN message_attachments AS ma ON ma.attachment_id = a.id
WHERE a.id = $1;

-- name: ListAttachmentRowsByIDs :many
SELECT
    a.id,
    a.owner_user_id,
    a.scope_kind,
    a.direct_chat_id,
    a.group_id,
    a.bucket_name,
    a.object_key,
    a.file_name,
    a.mime_type,
    a.relay_schema,
    a.size_bytes,
    a.status,
    a.created_at,
    a.updated_at,
    a.uploaded_at,
    a.attached_at,
    a.failed_at,
    a.deleted_at,
    s.id AS upload_session_id,
    s.owner_user_id AS upload_session_owner_user_id,
    s.status AS upload_session_status,
    s.expires_at AS upload_session_expires_at,
    s.created_at AS upload_session_created_at,
    s.updated_at AS upload_session_updated_at,
    s.completed_at AS upload_session_completed_at,
    s.failed_at AS upload_session_failed_at,
    ma.direct_chat_message_id,
    ma.group_message_id,
    ma.encrypted_direct_message_v2_id,
    ma.encrypted_group_message_v1_id
FROM attachments AS a
LEFT JOIN attachment_upload_sessions AS s ON s.attachment_id = a.id
LEFT JOIN message_attachments AS ma ON ma.attachment_id = a.id
WHERE a.id = ANY($1::uuid[]);

-- name: ListActiveCryptoDevicesByUserIDs :many
SELECT
    id,
    user_id,
    status
FROM crypto_devices
WHERE status = 'active'
  AND user_id = ANY($1::uuid[])
ORDER BY user_id ASC, created_at ASC, id ASC;

-- name: ListCurrentCryptoDeviceBundlesByDeviceIDs :many
SELECT
    crypto_device_id,
    bundle_version,
    crypto_suite,
    identity_public_key,
    signed_prekey_public,
    signed_prekey_id,
    signed_prekey_signature,
    kem_public_key,
    kem_key_id,
    kem_signature,
    one_time_prekeys_total,
    one_time_prekeys_available,
    bundle_digest,
    published_at,
    expires_at
FROM crypto_device_bundles
WHERE superseded_at IS NULL
  AND crypto_device_id = ANY($1::uuid[])
ORDER BY crypto_device_id ASC;

-- name: CompleteAttachmentUpload :execrows
WITH updated_attachment AS (
    UPDATE attachments
    SET
        status = 'uploaded',
        updated_at = $3,
        uploaded_at = $3,
        failed_at = NULL
    WHERE id = $1 AND owner_user_id = $2 AND status = 'pending'
    RETURNING id
)
UPDATE attachment_upload_sessions
SET
    status = 'completed',
    updated_at = $3,
    completed_at = $3,
    failed_at = NULL
WHERE attachment_upload_sessions.id = $4
  AND attachment_upload_sessions.attachment_id = $1
  AND attachment_upload_sessions.owner_user_id = $2
  AND attachment_upload_sessions.status = 'pending'
  AND attachment_upload_sessions.expires_at > $3
  AND EXISTS (SELECT 1 FROM updated_attachment);

-- name: FailAttachmentUpload :execrows
WITH updated_attachment AS (
    UPDATE attachments
    SET
        status = 'failed',
        updated_at = $3,
        failed_at = $3
    WHERE id = $1 AND owner_user_id = $2 AND status = 'pending'
    RETURNING id
)
UPDATE attachment_upload_sessions
SET
    status = 'failed',
    updated_at = $3,
    failed_at = $3
WHERE attachment_upload_sessions.id = $4
  AND attachment_upload_sessions.attachment_id = $1
  AND attachment_upload_sessions.owner_user_id = $2
  AND attachment_upload_sessions.status = 'pending'
  AND EXISTS (SELECT 1 FROM updated_attachment);

-- name: ExpireAttachmentUploadSession :execrows
WITH updated_attachment AS (
    UPDATE attachments
    SET
        status = 'expired',
        updated_at = $4
    WHERE id = $1
      AND owner_user_id = $2
      AND status = 'pending'
    RETURNING id
)
UPDATE attachment_upload_sessions
SET
    status = 'expired',
    updated_at = $4
WHERE attachment_upload_sessions.id = $3
  AND attachment_upload_sessions.attachment_id = $1
  AND attachment_upload_sessions.owner_user_id = $2
  AND attachment_upload_sessions.status = 'pending'
  AND attachment_upload_sessions.expires_at <= $4
  AND EXISTS (SELECT 1 FROM updated_attachment);

-- name: ExpirePendingAttachmentUploadSessions :execrows
WITH candidates AS (
    SELECT s.id, s.attachment_id
    FROM attachment_upload_sessions AS s
    JOIN attachments AS a ON a.id = s.attachment_id
    LEFT JOIN message_attachments AS ma ON ma.attachment_id = a.id
    WHERE s.status = 'pending'
      AND s.expires_at <= $1
      AND a.status = 'pending'
      AND ma.attachment_id IS NULL
    ORDER BY s.expires_at ASC, s.id ASC
    LIMIT $2
    FOR UPDATE OF s, a SKIP LOCKED
),
updated_attachments AS (
    UPDATE attachments AS a
    SET
        status = 'expired',
        updated_at = $1
    FROM candidates
    WHERE a.id = candidates.attachment_id
      AND a.status = 'pending'
    RETURNING a.id
)
UPDATE attachment_upload_sessions AS s
SET
    status = 'expired',
    updated_at = $1
FROM candidates
WHERE s.id = candidates.id
  AND s.status = 'pending';

-- name: ExpireOrphanUploadedAttachments :execrows
WITH candidates AS (
    SELECT a.id
    FROM attachments AS a
    LEFT JOIN message_attachments AS ma ON ma.attachment_id = a.id
    WHERE a.status = 'uploaded'
      AND a.uploaded_at IS NOT NULL
      AND a.uploaded_at <= $1
      AND ma.attachment_id IS NULL
    ORDER BY a.uploaded_at ASC, a.id ASC
    LIMIT $2
    FOR UPDATE OF a SKIP LOCKED
)
UPDATE attachments AS a
SET
    status = 'expired',
    updated_at = $3
FROM candidates
WHERE a.id = candidates.id
  AND a.status = 'uploaded';

-- name: ListAttachmentObjectDeletionCandidates :many
SELECT
    a.id,
    a.object_key,
    a.status
FROM attachments AS a
WHERE
  (
      a.status = 'expired'
      AND a.updated_at < $1
      AND NOT EXISTS (
          SELECT 1
          FROM message_attachments AS ma
          WHERE ma.attachment_id = a.id
      )
  )
  OR (
      a.status = 'failed'
      AND a.failed_at IS NOT NULL
      AND a.failed_at <= $2
      AND NOT EXISTS (
          SELECT 1
          FROM message_attachments AS ma
          WHERE ma.attachment_id = a.id
      )
  )
  OR (
      a.status = 'detached'
      AND a.updated_at <= $3
  )
ORDER BY
    CASE
        WHEN a.status = 'expired' THEN 0
        WHEN a.status = 'detached' THEN 1
        ELSE 2
    END ASC,
    COALESCE(a.failed_at, a.updated_at) ASC,
    a.id ASC
LIMIT $4;

-- name: MarkAttachmentDeleted :execrows
UPDATE attachments AS a
SET
    status = 'deleted',
    updated_at = $2,
    deleted_at = $2
WHERE a.id = $1
  AND (
      a.status = 'detached'
      OR (
          a.status IN ('expired', 'failed')
          AND NOT EXISTS (
              SELECT 1
              FROM message_attachments AS ma
              WHERE ma.attachment_id = a.id
          )
      )
  );

-- name: DetachDirectMessageAttachments :execrows
UPDATE attachments AS a
SET
    status = 'detached',
    updated_at = $2
FROM message_attachments AS ma
WHERE ma.attachment_id = a.id
  AND ma.direct_chat_message_id = $1
  AND a.status = 'attached';

-- name: DetachEncryptedDirectMessageV2Attachments :execrows
UPDATE attachments AS a
SET
    status = 'detached',
    updated_at = $2
FROM message_attachments AS ma
WHERE ma.attachment_id = a.id
  AND ma.encrypted_direct_message_v2_id = $1
  AND a.status = 'attached';

-- name: DetachEncryptedGroupMessageV1Attachments :execrows
UPDATE attachments AS a
SET
    status = 'detached',
    updated_at = $2
FROM message_attachments AS ma
WHERE ma.attachment_id = a.id
  AND ma.encrypted_group_message_v1_id = $1
  AND a.status = 'attached';

-- name: AttachDirectMessageAttachment :exec
INSERT INTO message_attachments (
    attachment_id,
    direct_chat_message_id,
    attached_by_user_id,
    created_at
) VALUES ($1, $2, $3, $4);

-- name: AttachGroupMessageAttachment :exec
INSERT INTO message_attachments (
    attachment_id,
    group_message_id,
    attached_by_user_id,
    created_at
) VALUES ($1, $2, $3, $4);

-- name: AttachEncryptedDirectMessageV2Attachment :exec
INSERT INTO message_attachments (
    attachment_id,
    encrypted_direct_message_v2_id,
    attached_by_user_id,
    created_at
) VALUES ($1, $2, $3, $4);

-- name: AttachEncryptedGroupMessageV1Attachment :exec
INSERT INTO message_attachments (
    attachment_id,
    encrypted_group_message_v1_id,
    attached_by_user_id,
    created_at
) VALUES ($1, $2, $3, $4);

-- name: MarkAttachmentAttached :execrows
UPDATE attachments
SET
    status = 'attached',
    updated_at = $2,
    attached_at = $2
WHERE id = $1 AND status = 'uploaded';

-- name: ListDirectMessageAttachmentRowsByMessageIDs :many
SELECT
    ma.direct_chat_message_id,
    a.id,
    a.owner_user_id,
    a.scope_kind,
    a.direct_chat_id,
    a.group_id,
    a.bucket_name,
    a.object_key,
    a.file_name,
    a.mime_type,
    a.relay_schema,
    a.size_bytes,
    a.status,
    a.created_at,
    a.updated_at,
    a.uploaded_at,
    a.attached_at,
    a.failed_at,
    a.deleted_at
FROM message_attachments AS ma
JOIN attachments AS a ON a.id = ma.attachment_id
WHERE ma.direct_chat_message_id = ANY($1::uuid[])
ORDER BY ma.created_at ASC, a.id ASC;

-- name: ListGroupMessageAttachmentRowsByMessageIDs :many
SELECT
    ma.group_message_id,
    a.id,
    a.owner_user_id,
    a.scope_kind,
    a.direct_chat_id,
    a.group_id,
    a.bucket_name,
    a.object_key,
    a.file_name,
    a.mime_type,
    a.relay_schema,
    a.size_bytes,
    a.status,
    a.created_at,
    a.updated_at,
    a.uploaded_at,
    a.attached_at,
    a.failed_at,
    a.deleted_at
FROM message_attachments AS ma
JOIN attachments AS a ON a.id = ma.attachment_id
WHERE ma.group_message_id = ANY($1::uuid[])
ORDER BY ma.created_at ASC, a.id ASC;

-- name: CreateGroupMessage :one
INSERT INTO group_messages (
    id,
    thread_id,
    sender_user_id,
    kind,
    text_content,
    markdown_policy,
    reply_to_message_id,
    created_at,
    updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id, thread_id, sender_user_id, kind, text_content, markdown_policy, reply_to_message_id, created_at, updated_at, edited_at;

-- name: ListGroupReplyPreviewRows :many
SELECT
    m.id,
    m.sender_user_id,
    u.login,
    u.nickname,
    u.avatar_url,
    m.text_content,
    COALESCE((
        SELECT COUNT(*)::INT
        FROM message_attachments AS ma
        WHERE ma.group_message_id = m.id
    ), 0)::INT AS attachment_count
FROM group_memberships AS self
JOIN group_threads AS t ON t.group_id = self.group_id
JOIN group_messages AS m ON m.thread_id = t.id
JOIN users AS u ON u.id = m.sender_user_id
WHERE self.user_id = $1
  AND self.group_id = $2
  AND t.thread_key = 'primary'
  AND m.id = ANY($3::UUID[]);

-- name: TouchDirectChatUpdatedAt :exec
UPDATE direct_chats
SET updated_at = $2
WHERE id = $1;

-- name: TouchGroupThreadUpdatedAt :exec
UPDATE group_threads
SET updated_at = $2
WHERE id = $1;

-- name: TouchDirectChatMessageUpdatedAt :exec
UPDATE direct_chat_messages
SET updated_at = $2
WHERE id = $1;

-- name: EditDirectChatMessageText :execrows
UPDATE direct_chat_messages
SET
    text_content = $3,
    updated_at = $4,
    edited_at = $4
WHERE chat_id = $1
  AND id = $2;

-- name: EditGroupMessageText :execrows
UPDATE group_messages AS m
SET
    text_content = $3,
    updated_at = $4,
    edited_at = $4
FROM group_threads AS t
WHERE m.id = $2
  AND m.thread_id = t.id
  AND t.group_id = $1;

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

-- name: UpsertEncryptedDirectChatReadState :execrows
INSERT INTO direct_chat_encrypted_read_states_v1 (
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
WHERE direct_chat_encrypted_read_states_v1.last_read_message_created_at < EXCLUDED.last_read_message_created_at
   OR (
        direct_chat_encrypted_read_states_v1.last_read_message_created_at = EXCLUDED.last_read_message_created_at
        AND direct_chat_encrypted_read_states_v1.last_read_message_id < EXCLUDED.last_read_message_id
   );

-- name: ListDirectChatEncryptedMessageV2ByDevice :many
SELECT
    m.id,
    m.chat_id,
    m.sender_user_id,
    m.sender_crypto_device_id,
    m.operation_kind,
    m.target_message_id,
    m.revision,
    m.created_at,
    m.stored_at,
    d.recipient_user_id,
    d.recipient_crypto_device_id,
    d.transport_header,
    d.ciphertext,
    d.ciphertext_size_bytes,
    d.stored_at AS delivery_stored_at
FROM direct_chat_encrypted_messages_v2 AS m
JOIN direct_chat_participants AS self ON self.chat_id = m.chat_id
JOIN direct_chat_encrypted_message_deliveries_v2 AS d ON d.message_id = m.id
WHERE self.user_id = $1
  AND m.chat_id = $2
  AND d.recipient_user_id = $1
  AND d.recipient_crypto_device_id = $3
ORDER BY m.created_at DESC, m.id DESC
LIMIT $4;

-- name: GetDirectChatEncryptedMessageV2ByDevice :one
SELECT
    m.id,
    m.chat_id,
    m.sender_user_id,
    m.sender_crypto_device_id,
    m.operation_kind,
    m.target_message_id,
    m.revision,
    m.created_at,
    m.stored_at,
    d.recipient_user_id,
    d.recipient_crypto_device_id,
    d.transport_header,
    d.ciphertext,
    d.ciphertext_size_bytes,
    d.stored_at AS delivery_stored_at
FROM direct_chat_encrypted_messages_v2 AS m
JOIN direct_chat_participants AS self ON self.chat_id = m.chat_id
JOIN direct_chat_encrypted_message_deliveries_v2 AS d ON d.message_id = m.id
WHERE self.user_id = $1
  AND m.chat_id = $2
  AND m.id = $3
  AND d.recipient_user_id = $1
  AND d.recipient_crypto_device_id = $4;

-- name: GetDirectChatEncryptedMessageV2Stored :one
SELECT
    id,
    chat_id,
    sender_user_id,
    sender_crypto_device_id,
    operation_kind,
    target_message_id,
    revision,
    created_at,
    stored_at
FROM direct_chat_encrypted_messages_v2
WHERE chat_id = $1 AND id = $2;

-- name: ListEncryptedGroupMessagesByDevice :many
SELECT
    m.id,
    m.group_id,
    m.thread_id,
    m.mls_group_id,
    m.roster_version,
    m.sender_user_id,
    m.sender_crypto_device_id,
    m.operation_kind,
    m.target_message_id,
    m.revision,
    m.ciphertext,
    m.ciphertext_size_bytes,
    m.created_at,
    m.stored_at,
    d.recipient_user_id,
    d.recipient_crypto_device_id,
    d.stored_at AS delivery_stored_at
FROM group_encrypted_messages_v1 AS m
JOIN group_memberships AS self ON self.group_id = m.group_id
JOIN group_encrypted_message_deliveries_v1 AS d ON d.message_id = m.id
WHERE self.user_id = $1
  AND m.group_id = $2
  AND d.recipient_user_id = $1
  AND d.recipient_crypto_device_id = $3
ORDER BY m.created_at DESC, m.id DESC
LIMIT $4;

-- name: GetEncryptedGroupMessageByDevice :one
SELECT
    m.id,
    m.group_id,
    m.thread_id,
    m.mls_group_id,
    m.roster_version,
    m.sender_user_id,
    m.sender_crypto_device_id,
    m.operation_kind,
    m.target_message_id,
    m.revision,
    m.ciphertext,
    m.ciphertext_size_bytes,
    m.created_at,
    m.stored_at,
    d.recipient_user_id,
    d.recipient_crypto_device_id,
    d.stored_at AS delivery_stored_at
FROM group_encrypted_messages_v1 AS m
JOIN group_memberships AS self ON self.group_id = m.group_id
JOIN group_encrypted_message_deliveries_v1 AS d ON d.message_id = m.id
WHERE self.user_id = $1
  AND m.group_id = $2
  AND m.id = $3
  AND d.recipient_user_id = $1
  AND d.recipient_crypto_device_id = $4;

-- name: GetEncryptedGroupStoredMessage :one
SELECT
    id,
    group_id,
    thread_id,
    mls_group_id,
    roster_version,
    sender_user_id,
    sender_crypto_device_id,
    operation_kind,
    target_message_id,
    revision,
    created_at,
    stored_at
FROM group_encrypted_messages_v1
WHERE group_id = $1 AND id = $2;

-- name: UpsertGroupChatReadState :execrows
INSERT INTO group_chat_read_states (
    group_id,
    user_id,
    last_read_message_id,
    last_read_message_created_at,
    updated_at
) VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (group_id, user_id) DO UPDATE
SET
    last_read_message_id = EXCLUDED.last_read_message_id,
    last_read_message_created_at = EXCLUDED.last_read_message_created_at,
    updated_at = EXCLUDED.updated_at
WHERE group_chat_read_states.last_read_message_created_at < EXCLUDED.last_read_message_created_at
   OR (
        group_chat_read_states.last_read_message_created_at = EXCLUDED.last_read_message_created_at
        AND group_chat_read_states.last_read_message_id < EXCLUDED.last_read_message_id
   );

-- name: UpsertEncryptedGroupReadState :execrows
INSERT INTO group_encrypted_read_states_v1 (
    group_id,
    user_id,
    last_read_message_id,
    last_read_message_created_at,
    updated_at
) VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (group_id, user_id) DO UPDATE
SET
    last_read_message_id = EXCLUDED.last_read_message_id,
    last_read_message_created_at = EXCLUDED.last_read_message_created_at,
    updated_at = EXCLUDED.updated_at
WHERE group_encrypted_read_states_v1.last_read_message_created_at < EXCLUDED.last_read_message_created_at
   OR (
        group_encrypted_read_states_v1.last_read_message_created_at = EXCLUDED.last_read_message_created_at
        AND group_encrypted_read_states_v1.last_read_message_id < EXCLUDED.last_read_message_id
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

-- name: PinEncryptedDirectMessageV2 :execrows
INSERT INTO direct_chat_encrypted_message_pins_v2 (
    chat_id,
    message_id,
    pinned_by_user_id,
    created_at
) VALUES ($1, $2, $3, $4)
ON CONFLICT (chat_id, message_id) DO NOTHING;

-- name: UnpinEncryptedDirectMessageV2 :execrows
DELETE FROM direct_chat_encrypted_message_pins_v2
WHERE chat_id = $1 AND message_id = $2;

-- name: PinEncryptedGroupMessage :execrows
INSERT INTO group_encrypted_message_pins_v1 (
    group_id,
    message_id,
    pinned_by_user_id,
    created_at
) VALUES ($1, $2, $3, $4)
ON CONFLICT (group_id, message_id) DO NOTHING;

-- name: UnpinEncryptedGroupMessage :execrows
DELETE FROM group_encrypted_message_pins_v1
WHERE group_id = $1 AND message_id = $2;
