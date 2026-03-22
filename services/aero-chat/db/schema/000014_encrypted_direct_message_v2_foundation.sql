CREATE TABLE direct_chat_encrypted_messages_v2 (
    id UUID PRIMARY KEY,
    chat_id UUID NOT NULL REFERENCES direct_chats (id) ON DELETE CASCADE,
    sender_user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    sender_crypto_device_id UUID NOT NULL REFERENCES crypto_devices (id) ON DELETE RESTRICT,
    operation_kind TEXT NOT NULL,
    target_message_id UUID NULL REFERENCES direct_chat_encrypted_messages_v2 (id) ON DELETE RESTRICT,
    revision INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    stored_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT direct_chat_encrypted_messages_v2_operation_kind CHECK (
        operation_kind IN ('content', 'edit', 'tombstone')
    ),
    CONSTRAINT direct_chat_encrypted_messages_v2_revision_positive CHECK (revision > 0),
    CONSTRAINT direct_chat_encrypted_messages_v2_target_shape CHECK (
        (operation_kind = 'content' AND target_message_id IS NULL)
        OR (operation_kind IN ('edit', 'tombstone') AND target_message_id IS NOT NULL)
    ),
    CONSTRAINT direct_chat_encrypted_messages_v2_stored_after_create CHECK (stored_at >= created_at)
);

CREATE INDEX idx_direct_chat_encrypted_messages_v2_chat_created_at
    ON direct_chat_encrypted_messages_v2 (chat_id, created_at DESC, id DESC);

CREATE INDEX idx_direct_chat_encrypted_messages_v2_sender_user_id
    ON direct_chat_encrypted_messages_v2 (sender_user_id, created_at DESC, id DESC);

CREATE INDEX idx_direct_chat_encrypted_messages_v2_target_message_id
    ON direct_chat_encrypted_messages_v2 (target_message_id)
    WHERE target_message_id IS NOT NULL;

CREATE TABLE direct_chat_encrypted_message_deliveries_v2 (
    message_id UUID NOT NULL REFERENCES direct_chat_encrypted_messages_v2 (id) ON DELETE CASCADE,
    recipient_user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    recipient_crypto_device_id UUID NOT NULL REFERENCES crypto_devices (id) ON DELETE RESTRICT,
    transport_header BYTEA NOT NULL,
    ciphertext BYTEA NOT NULL,
    ciphertext_size_bytes BIGINT NOT NULL,
    stored_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (message_id, recipient_crypto_device_id),
    CONSTRAINT direct_chat_encrypted_message_deliveries_v2_ciphertext_nonempty CHECK (
        octet_length(ciphertext) > 0
    ),
    CONSTRAINT direct_chat_encrypted_message_deliveries_v2_ciphertext_size_positive CHECK (
        ciphertext_size_bytes > 0
    )
);

CREATE INDEX idx_direct_chat_encrypted_message_deliveries_v2_recipient_device
    ON direct_chat_encrypted_message_deliveries_v2 (recipient_crypto_device_id, stored_at DESC, message_id DESC);

CREATE INDEX idx_direct_chat_encrypted_message_deliveries_v2_recipient_user
    ON direct_chat_encrypted_message_deliveries_v2 (recipient_user_id, stored_at DESC, message_id DESC);
