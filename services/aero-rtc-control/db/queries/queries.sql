-- name: GetCallByID :one
SELECT
    c.id,
    c.scope_type,
    c.direct_chat_id,
    c.group_id,
    c.created_by_user_id,
    c.status,
    c.created_at,
    c.started_at,
    c.updated_at,
    c.ended_at,
    c.ended_by_user_id,
    c.end_reason,
    COALESCE(active.active_participant_count, 0)::bigint AS active_participant_count
FROM rtc_calls c
LEFT JOIN (
    SELECT call_id, COUNT(*)::bigint AS active_participant_count
    FROM rtc_call_participants
    WHERE state = 'active'
    GROUP BY call_id
) active ON active.call_id = c.id
WHERE c.id = sqlc.arg(id);

-- name: GetActiveCallByDirectChatID :one
SELECT
    c.id,
    c.scope_type,
    c.direct_chat_id,
    c.group_id,
    c.created_by_user_id,
    c.status,
    c.created_at,
    c.started_at,
    c.updated_at,
    c.ended_at,
    c.ended_by_user_id,
    c.end_reason,
    COALESCE(active.active_participant_count, 0)::bigint AS active_participant_count
FROM rtc_calls c
LEFT JOIN (
    SELECT call_id, COUNT(*)::bigint AS active_participant_count
    FROM rtc_call_participants
    WHERE state = 'active'
    GROUP BY call_id
) active ON active.call_id = c.id
WHERE c.direct_chat_id = sqlc.arg(direct_chat_id)
  AND c.status = 'active';

-- name: GetActiveCallByGroupID :one
SELECT
    c.id,
    c.scope_type,
    c.direct_chat_id,
    c.group_id,
    c.created_by_user_id,
    c.status,
    c.created_at,
    c.started_at,
    c.updated_at,
    c.ended_at,
    c.ended_by_user_id,
    c.end_reason,
    COALESCE(active.active_participant_count, 0)::bigint AS active_participant_count
FROM rtc_calls c
LEFT JOIN (
    SELECT call_id, COUNT(*)::bigint AS active_participant_count
    FROM rtc_call_participants
    WHERE state = 'active'
    GROUP BY call_id
) active ON active.call_id = c.id
WHERE c.group_id = sqlc.arg(group_id)
  AND c.status = 'active';

-- name: CreateCall :one
INSERT INTO rtc_calls (
    id,
    scope_type,
    direct_chat_id,
    group_id,
    created_by_user_id,
    status,
    created_at,
    started_at,
    updated_at
) VALUES (
    sqlc.arg(id),
    sqlc.arg(scope_type),
    sqlc.arg(direct_chat_id),
    sqlc.arg(group_id),
    sqlc.arg(created_by_user_id),
    sqlc.arg(status),
    sqlc.arg(created_at),
    sqlc.arg(started_at),
    sqlc.arg(updated_at)
)
RETURNING
    id,
    scope_type,
    direct_chat_id,
    group_id,
    created_by_user_id,
    status,
    created_at,
    started_at,
    updated_at,
    ended_at,
    ended_by_user_id,
    end_reason;

-- name: EndCall :execrows
UPDATE rtc_calls
SET
    status = 'ended',
    updated_at = sqlc.arg(updated_at),
    ended_at = sqlc.arg(ended_at),
    ended_by_user_id = sqlc.arg(ended_by_user_id),
    end_reason = sqlc.arg(end_reason)
WHERE id = sqlc.arg(id)
  AND status = 'active';

-- name: CreateParticipant :one
INSERT INTO rtc_call_participants (
    id,
    call_id,
    user_id,
    state,
    joined_at,
    updated_at
) VALUES (
    sqlc.arg(id),
    sqlc.arg(call_id),
    sqlc.arg(user_id),
    sqlc.arg(state),
    sqlc.arg(joined_at),
    sqlc.arg(updated_at)
)
RETURNING id, call_id, user_id, state, joined_at, left_at, updated_at, last_signal_at;

-- name: GetActiveParticipantByCallIDAndUserID :one
SELECT id, call_id, user_id, state, joined_at, left_at, updated_at, last_signal_at
FROM rtc_call_participants
WHERE call_id = sqlc.arg(call_id)
  AND user_id = sqlc.arg(user_id)
  AND state = 'active';

-- name: ListParticipantsByCallID :many
SELECT id, call_id, user_id, state, joined_at, left_at, updated_at, last_signal_at
FROM rtc_call_participants
WHERE call_id = sqlc.arg(call_id)
ORDER BY joined_at ASC, id ASC;

-- name: ListActiveParticipantsByCallID :many
SELECT id, call_id, user_id, state, joined_at, left_at, updated_at, last_signal_at
FROM rtc_call_participants
WHERE call_id = sqlc.arg(call_id)
  AND state = 'active'
ORDER BY joined_at ASC, id ASC;

-- name: LeaveParticipant :execrows
UPDATE rtc_call_participants
SET
    state = 'left',
    left_at = sqlc.arg(left_at),
    updated_at = sqlc.arg(updated_at)
WHERE id = sqlc.arg(id)
  AND state = 'active';

-- name: LeaveActiveParticipantsByCallID :execrows
UPDATE rtc_call_participants
SET
    state = 'left',
    left_at = sqlc.arg(left_at),
    updated_at = sqlc.arg(updated_at)
WHERE call_id = sqlc.arg(call_id)
  AND state = 'active';

-- name: TouchParticipantSignal :execrows
UPDATE rtc_call_participants
SET
    last_signal_at = sqlc.arg(last_signal_at),
    updated_at = sqlc.arg(updated_at)
WHERE id = sqlc.arg(id)
  AND state = 'active';

-- name: CountActiveParticipantsByCallID :one
SELECT COUNT(*)::bigint
FROM rtc_call_participants
WHERE call_id = sqlc.arg(call_id)
  AND state = 'active';
