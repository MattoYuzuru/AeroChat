-- name: CreateUser :one
INSERT INTO users (
    id,
    login,
    nickname,
    avatar_url,
    bio,
    timezone,
    profile_accent,
    status_text,
    birthday,
    country,
    city,
    read_receipts_enabled,
    presence_enabled,
    typing_visibility_enabled,
    key_backup_status,
    created_at,
    updated_at
) VALUES (
    $1,
    $2,
    $3,
    $4,
    $5,
    $6,
    $7,
    $8,
    $9,
    $10,
    $11,
    $12,
    $13,
    $14,
    $15,
    $16,
    $17
)
RETURNING
    id,
    login,
    nickname,
    avatar_url,
    bio,
    timezone,
    profile_accent,
    status_text,
    birthday,
    country,
    city,
    read_receipts_enabled,
    presence_enabled,
    typing_visibility_enabled,
    key_backup_status,
    created_at,
    updated_at;

-- name: CreateUserPasswordCredential :exec
INSERT INTO user_password_credentials (
    user_id,
    password_hash,
    created_at,
    updated_at
) VALUES ($1, $2, $3, $4);

-- name: CreateDevice :one
INSERT INTO user_devices (
    id,
    user_id,
    label,
    created_at,
    last_seen_at,
    revoked_at
) VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, user_id, label, created_at, last_seen_at, revoked_at;

-- name: CreateSession :one
INSERT INTO user_sessions (
    id,
    user_id,
    device_id,
    token_hash,
    created_at,
    last_seen_at,
    revoked_at
) VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, user_id, device_id, token_hash, created_at, last_seen_at, revoked_at;

-- name: GetPasswordCredentialByLogin :one
SELECT
    u.id,
    u.login,
    u.nickname,
    u.avatar_url,
    u.bio,
    u.timezone,
    u.profile_accent,
    u.status_text,
    u.birthday,
    u.country,
    u.city,
    u.read_receipts_enabled,
    u.presence_enabled,
    u.typing_visibility_enabled,
    u.key_backup_status,
    u.created_at,
    u.updated_at,
    c.password_hash,
    c.created_at AS password_created_at,
    c.updated_at AS password_updated_at
FROM users AS u
JOIN user_password_credentials AS c ON c.user_id = u.id
WHERE u.login = $1;

-- name: GetUserByID :one
SELECT
    id,
    login,
    nickname,
    avatar_url,
    bio,
    timezone,
    profile_accent,
    status_text,
    birthday,
    country,
    city,
    read_receipts_enabled,
    presence_enabled,
    typing_visibility_enabled,
    key_backup_status,
    created_at,
    updated_at
FROM users
WHERE id = $1;

-- name: GetUserByLogin :one
SELECT
    id,
    login,
    nickname,
    avatar_url,
    bio,
    timezone,
    profile_accent,
    status_text,
    birthday,
    country,
    city,
    read_receipts_enabled,
    presence_enabled,
    typing_visibility_enabled,
    key_backup_status,
    created_at,
    updated_at
FROM users
WHERE login = $1;

-- name: UpdateUserProfile :one
UPDATE users
SET
    nickname = $2,
    avatar_url = $3,
    bio = $4,
    timezone = $5,
    profile_accent = $6,
    status_text = $7,
    birthday = $8,
    country = $9,
    city = $10,
    read_receipts_enabled = $11,
    presence_enabled = $12,
    typing_visibility_enabled = $13,
    key_backup_status = $14,
    updated_at = $15
WHERE id = $1
RETURNING
    id,
    login,
    nickname,
    avatar_url,
    bio,
    timezone,
    profile_accent,
    status_text,
    birthday,
    country,
    city,
    read_receipts_enabled,
    presence_enabled,
    typing_visibility_enabled,
    key_backup_status,
    created_at,
    updated_at;

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
    u.bio,
    u.timezone,
    u.profile_accent,
    u.status_text,
    u.birthday,
    u.country,
    u.city,
    u.read_receipts_enabled,
    u.presence_enabled,
    u.typing_visibility_enabled,
    u.key_backup_status,
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

-- name: RevokeSession :execrows
UPDATE user_sessions
SET revoked_at = $3
WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL;

-- name: RevokeDeviceSessions :exec
UPDATE user_sessions
SET revoked_at = $3
WHERE device_id = $1 AND user_id = $2 AND revoked_at IS NULL;

-- name: RevokeDevice :execrows
UPDATE user_devices
SET revoked_at = $3
WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL;

-- name: ListDevicesByUserID :many
SELECT
    id,
    user_id,
    label,
    created_at,
    last_seen_at,
    revoked_at
FROM user_devices
WHERE user_id = $1
ORDER BY created_at DESC;

-- name: ListSessionsByUserID :many
SELECT
    id,
    user_id,
    device_id,
    token_hash,
    created_at,
    last_seen_at,
    revoked_at
FROM user_sessions
WHERE user_id = $1
ORDER BY created_at DESC;

-- name: CreateUserBlock :exec
INSERT INTO user_blocks (
    blocker_user_id,
    blocked_user_id,
    created_at
) VALUES ($1, $2, $3)
ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING;

-- name: DeleteUserBlock :execrows
DELETE FROM user_blocks
WHERE blocker_user_id = $1 AND blocked_user_id = $2;

-- name: ListBlockedUsersByUserID :many
SELECT
    b.created_at AS blocked_at,
    u.id,
    u.login,
    u.nickname,
    u.avatar_url,
    u.bio,
    u.timezone,
    u.profile_accent,
    u.status_text,
    u.birthday,
    u.country,
    u.city,
    u.read_receipts_enabled,
    u.presence_enabled,
    u.typing_visibility_enabled,
    u.key_backup_status,
    u.created_at,
    u.updated_at
FROM user_blocks AS b
JOIN users AS u ON u.id = b.blocked_user_id
WHERE b.blocker_user_id = $1
ORDER BY b.created_at DESC;
