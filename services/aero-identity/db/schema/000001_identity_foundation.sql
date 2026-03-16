CREATE TABLE users (
    id UUID PRIMARY KEY,
    login TEXT NOT NULL UNIQUE,
    nickname TEXT NOT NULL,
    avatar_url TEXT NULL,
    bio TEXT NULL,
    timezone TEXT NULL,
    profile_accent TEXT NULL,
    status_text TEXT NULL,
    birthday DATE NULL,
    country TEXT NULL,
    city TEXT NULL,
    read_receipts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    presence_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    typing_visibility_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    key_backup_status TEXT NOT NULL DEFAULT 'not_configured',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT users_login_format CHECK (login ~ '^[a-z0-9._-]{3,32}$'),
    CONSTRAINT users_nickname_length CHECK (char_length(nickname) BETWEEN 1 AND 64),
    CONSTRAINT users_key_backup_status CHECK (
        key_backup_status IN ('not_configured', 'configured')
    )
);

CREATE TABLE user_password_credentials (
    user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE user_devices (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NULL,
    CONSTRAINT user_devices_label_length CHECK (char_length(label) BETWEEN 1 AND 120)
);

CREATE INDEX idx_user_devices_user_id ON user_devices (user_id, created_at DESC);

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES user_devices (id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NULL,
    CONSTRAINT user_sessions_token_hash_length CHECK (char_length(token_hash) = 64)
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions (user_id, created_at DESC);
CREATE INDEX idx_user_sessions_device_id ON user_sessions (device_id, created_at DESC);

CREATE TABLE user_blocks (
    blocker_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    blocked_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (blocker_user_id, blocked_user_id),
    CONSTRAINT user_blocks_not_self CHECK (blocker_user_id <> blocked_user_id)
);

CREATE INDEX idx_user_blocks_blocked_user_id ON user_blocks (blocked_user_id);
