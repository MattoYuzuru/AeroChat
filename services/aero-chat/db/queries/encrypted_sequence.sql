-- name: ReserveDirectEncryptedSequence :one
UPDATE direct_chats SET encrypted_server_sequence = encrypted_server_sequence + 1
WHERE id = $1 RETURNING encrypted_server_sequence;

-- name: ReserveGroupEncryptedSequence :one
UPDATE groups SET encrypted_server_sequence = encrypted_server_sequence + 1
WHERE id = $1 RETURNING encrypted_server_sequence;

-- name: LockDirectEncryptedConversation :one
SELECT encrypted_server_sequence FROM direct_chats WHERE id = $1 FOR UPDATE;

-- name: LockGroupEncryptedConversation :one
SELECT encrypted_server_sequence FROM groups WHERE id = $1 FOR UPDATE;

-- name: EncryptedSequencesReady :one
SELECT NOT EXISTS (
    SELECT 1 FROM direct_chat_encrypted_messages_v2 WHERE server_sequence IS NULL
    UNION ALL
    SELECT 1 FROM group_encrypted_messages_v1 WHERE server_sequence IS NULL
    UNION ALL
    SELECT 1 FROM direct_chats c
    WHERE c.encrypted_server_sequence < (SELECT COALESCE(MAX(m.server_sequence), 0) FROM direct_chat_encrypted_messages_v2 m WHERE m.chat_id = c.id)
    UNION ALL
    SELECT 1 FROM groups g
    WHERE g.encrypted_server_sequence < (SELECT COALESCE(MAX(m.server_sequence), 0) FROM group_encrypted_messages_v1 m WHERE m.group_id = g.id)
    UNION ALL
    SELECT 1 FROM direct_chat_encrypted_read_states_v1 r
    LEFT JOIN direct_chat_encrypted_messages_v2 m ON m.id = r.last_read_message_id AND m.chat_id = r.chat_id AND m.operation_kind = 'content'
    WHERE m.server_sequence IS NULL OR r.last_read_server_sequence <> m.server_sequence
    UNION ALL
    SELECT 1 FROM group_encrypted_read_states_v1 r
    LEFT JOIN group_encrypted_messages_v1 m ON m.id = r.last_read_message_id AND m.group_id = r.group_id AND m.operation_kind = 'content'
    WHERE m.server_sequence IS NULL OR r.last_read_server_sequence <> m.server_sequence
) AS ready;

-- name: ListEncryptedSequenceBackfillConversations :many
SELECT 'direct'::TEXT AS kind, c.id FROM direct_chats c
WHERE EXISTS (SELECT 1 FROM direct_chat_encrypted_messages_v2 m WHERE m.chat_id = c.id AND m.server_sequence IS NULL)
   OR EXISTS (SELECT 1 FROM direct_chat_encrypted_read_states_v1 r LEFT JOIN direct_chat_encrypted_messages_v2 m ON m.id = r.last_read_message_id AND m.chat_id = r.chat_id AND m.operation_kind = 'content' WHERE r.chat_id = c.id AND (m.server_sequence IS NULL OR r.last_read_server_sequence <> m.server_sequence))
   OR c.encrypted_server_sequence < (SELECT COALESCE(MAX(m.server_sequence), 0) FROM direct_chat_encrypted_messages_v2 m WHERE m.chat_id = c.id)
UNION ALL
SELECT 'group'::TEXT AS kind, g.id FROM groups g
WHERE EXISTS (SELECT 1 FROM group_encrypted_messages_v1 m WHERE m.group_id = g.id AND m.server_sequence IS NULL)
   OR EXISTS (SELECT 1 FROM group_encrypted_read_states_v1 r LEFT JOIN group_encrypted_messages_v1 m ON m.id = r.last_read_message_id AND m.group_id = r.group_id AND m.operation_kind = 'content' WHERE r.group_id = g.id AND (m.server_sequence IS NULL OR r.last_read_server_sequence <> m.server_sequence))
   OR g.encrypted_server_sequence < (SELECT COALESCE(MAX(m.server_sequence), 0) FROM group_encrypted_messages_v1 m WHERE m.group_id = g.id)
ORDER BY kind, id LIMIT $1;

-- name: ListDirectEncryptedSequenceBackfillRows :many
SELECT id FROM direct_chat_encrypted_messages_v2
WHERE chat_id = $1 AND server_sequence IS NULL
ORDER BY created_at, id LIMIT $2;

-- name: ListGroupEncryptedSequenceBackfillRows :many
SELECT id FROM group_encrypted_messages_v1
WHERE group_id = $1 AND server_sequence IS NULL
ORDER BY created_at, id LIMIT $2;

-- name: SetDirectEncryptedSequenceCounter :one
UPDATE direct_chats
SET encrypted_server_sequence = GREATEST(encrypted_server_sequence, (SELECT COALESCE(MAX(m.server_sequence), 0) FROM direct_chat_encrypted_messages_v2 m WHERE m.chat_id = direct_chats.id)) + sqlc.arg(batch_size)::BIGINT
WHERE direct_chats.id = sqlc.arg(conversation_id) RETURNING direct_chats.encrypted_server_sequence;

-- name: SetGroupEncryptedSequenceCounter :one
UPDATE groups
SET encrypted_server_sequence = GREATEST(encrypted_server_sequence, (SELECT COALESCE(MAX(m.server_sequence), 0) FROM group_encrypted_messages_v1 m WHERE m.group_id = groups.id)) + sqlc.arg(batch_size)::BIGINT
WHERE groups.id = sqlc.arg(conversation_id) RETURNING groups.encrypted_server_sequence;

-- name: BackfillDirectEncryptedSequence :execrows
UPDATE direct_chat_encrypted_messages_v2 SET server_sequence = $3
WHERE chat_id = $1 AND id = $2 AND server_sequence IS NULL;

-- name: BackfillGroupEncryptedSequence :execrows
UPDATE group_encrypted_messages_v1 SET server_sequence = $3
WHERE group_id = $1 AND id = $2 AND server_sequence IS NULL;

-- name: RepairDirectEncryptedReadSequence :exec
UPDATE direct_chat_encrypted_read_states_v1 r
SET last_read_server_sequence = m.server_sequence
FROM direct_chat_encrypted_messages_v2 m
WHERE r.chat_id = $1 AND m.id = r.last_read_message_id AND m.chat_id = r.chat_id AND m.operation_kind = 'content' AND m.server_sequence IS NOT NULL;

-- name: RepairGroupEncryptedReadSequence :exec
UPDATE group_encrypted_read_states_v1 r
SET last_read_server_sequence = m.server_sequence
FROM group_encrypted_messages_v1 m
WHERE r.group_id = $1 AND m.id = r.last_read_message_id AND m.group_id = r.group_id AND m.operation_kind = 'content' AND m.server_sequence IS NOT NULL;

-- name: ResetInvalidDirectEncryptedReadSequence :exec
DELETE FROM direct_chat_encrypted_read_states_v1 r
WHERE r.chat_id = $1 AND NOT EXISTS (SELECT 1 FROM direct_chat_encrypted_messages_v2 m WHERE m.id = r.last_read_message_id AND m.chat_id = r.chat_id AND m.operation_kind = 'content' AND m.server_sequence IS NOT NULL);

-- name: ResetInvalidGroupEncryptedReadSequence :exec
DELETE FROM group_encrypted_read_states_v1 r
WHERE r.group_id = $1 AND NOT EXISTS (SELECT 1 FROM group_encrypted_messages_v1 m WHERE m.id = r.last_read_message_id AND m.group_id = r.group_id AND m.operation_kind = 'content' AND m.server_sequence IS NOT NULL);
