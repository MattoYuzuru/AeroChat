CREATE TABLE group_encrypted_lanes_v1 (
    group_id UUID PRIMARY KEY REFERENCES groups (id) ON DELETE CASCADE,
    thread_id UUID NOT NULL REFERENCES group_threads (id) ON DELETE CASCADE,
    mls_group_id UUID NOT NULL UNIQUE,
    roster_version BIGINT NOT NULL,
    activated_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT group_encrypted_lanes_v1_roster_version_positive CHECK (roster_version > 0),
    CONSTRAINT group_encrypted_lanes_v1_updated_after_activation CHECK (updated_at >= activated_at)
);

CREATE UNIQUE INDEX idx_group_encrypted_lanes_v1_thread_id
    ON group_encrypted_lanes_v1 (thread_id);

CREATE TABLE group_encrypted_roster_members_v1 (
    group_id UUID NOT NULL REFERENCES group_encrypted_lanes_v1 (group_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    role TEXT NOT NULL,
    is_write_restricted BOOLEAN NOT NULL DEFAULT FALSE,
    roster_version BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (group_id, user_id),
    CONSTRAINT group_encrypted_roster_members_v1_role CHECK (role IN ('owner', 'admin', 'member', 'reader')),
    CONSTRAINT group_encrypted_roster_members_v1_roster_version_positive CHECK (roster_version > 0),
    CONSTRAINT group_encrypted_roster_members_v1_updated_after_create CHECK (updated_at >= created_at)
);

CREATE INDEX idx_group_encrypted_roster_members_v1_user_id
    ON group_encrypted_roster_members_v1 (user_id, updated_at DESC, group_id DESC);

CREATE TABLE group_encrypted_roster_devices_v1 (
    group_id UUID NOT NULL,
    user_id UUID NOT NULL,
    crypto_device_id UUID NOT NULL REFERENCES crypto_devices (id) ON DELETE RESTRICT,
    roster_version BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (group_id, crypto_device_id),
    CONSTRAINT group_encrypted_roster_devices_v1_roster_member_fk
        FOREIGN KEY (group_id, user_id)
        REFERENCES group_encrypted_roster_members_v1 (group_id, user_id)
        ON DELETE CASCADE,
    CONSTRAINT group_encrypted_roster_devices_v1_roster_version_positive CHECK (roster_version > 0),
    CONSTRAINT group_encrypted_roster_devices_v1_updated_after_create CHECK (updated_at >= created_at)
);

CREATE INDEX idx_group_encrypted_roster_devices_v1_user_id
    ON group_encrypted_roster_devices_v1 (user_id, updated_at DESC, group_id DESC);

CREATE INDEX idx_group_encrypted_roster_devices_v1_crypto_device_id
    ON group_encrypted_roster_devices_v1 (crypto_device_id, updated_at DESC, group_id DESC);

CREATE TABLE group_encrypted_messages_v1 (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    thread_id UUID NOT NULL REFERENCES group_threads (id) ON DELETE CASCADE,
    mls_group_id UUID NOT NULL REFERENCES group_encrypted_lanes_v1 (mls_group_id) ON DELETE RESTRICT,
    roster_version BIGINT NOT NULL,
    sender_user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    sender_crypto_device_id UUID NOT NULL REFERENCES crypto_devices (id) ON DELETE RESTRICT,
    operation_kind TEXT NOT NULL,
    target_message_id UUID NULL REFERENCES group_encrypted_messages_v1 (id) ON DELETE RESTRICT,
    revision INTEGER NOT NULL,
    ciphertext BYTEA NOT NULL,
    ciphertext_size_bytes BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    stored_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT group_encrypted_messages_v1_operation_kind CHECK (
        operation_kind IN ('content', 'control')
    ),
    CONSTRAINT group_encrypted_messages_v1_roster_version_positive CHECK (roster_version > 0),
    CONSTRAINT group_encrypted_messages_v1_revision_positive CHECK (revision > 0),
    CONSTRAINT group_encrypted_messages_v1_target_shape CHECK (
        operation_kind <> 'content' OR target_message_id IS NULL
    ),
    CONSTRAINT group_encrypted_messages_v1_ciphertext_nonempty CHECK (octet_length(ciphertext) > 0),
    CONSTRAINT group_encrypted_messages_v1_ciphertext_size_positive CHECK (ciphertext_size_bytes > 0),
    CONSTRAINT group_encrypted_messages_v1_stored_after_create CHECK (stored_at >= created_at)
);

CREATE INDEX idx_group_encrypted_messages_v1_group_created_at
    ON group_encrypted_messages_v1 (group_id, created_at DESC, id DESC);

CREATE INDEX idx_group_encrypted_messages_v1_thread_created_at
    ON group_encrypted_messages_v1 (thread_id, created_at DESC, id DESC);

CREATE INDEX idx_group_encrypted_messages_v1_sender_user_id
    ON group_encrypted_messages_v1 (sender_user_id, created_at DESC, id DESC);

CREATE INDEX idx_group_encrypted_messages_v1_target_message_id
    ON group_encrypted_messages_v1 (target_message_id)
    WHERE target_message_id IS NOT NULL;

CREATE TABLE group_encrypted_message_deliveries_v1 (
    message_id UUID NOT NULL REFERENCES group_encrypted_messages_v1 (id) ON DELETE CASCADE,
    recipient_user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    recipient_crypto_device_id UUID NOT NULL REFERENCES crypto_devices (id) ON DELETE RESTRICT,
    stored_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (message_id, recipient_crypto_device_id)
);

CREATE INDEX idx_group_encrypted_message_deliveries_v1_recipient_device
    ON group_encrypted_message_deliveries_v1 (recipient_crypto_device_id, stored_at DESC, message_id DESC);

CREATE INDEX idx_group_encrypted_message_deliveries_v1_recipient_user
    ON group_encrypted_message_deliveries_v1 (recipient_user_id, stored_at DESC, message_id DESC);
