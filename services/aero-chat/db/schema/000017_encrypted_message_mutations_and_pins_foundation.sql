ALTER TABLE group_encrypted_messages_v1
    DROP CONSTRAINT group_encrypted_messages_v1_operation_kind,
    DROP CONSTRAINT group_encrypted_messages_v1_target_shape;

ALTER TABLE group_encrypted_messages_v1
    ADD CONSTRAINT group_encrypted_messages_v1_operation_kind CHECK (
        operation_kind IN ('content', 'control', 'edit', 'tombstone')
    ),
    ADD CONSTRAINT group_encrypted_messages_v1_target_shape CHECK (
        (operation_kind = 'content' AND target_message_id IS NULL)
        OR (operation_kind IN ('control', 'edit', 'tombstone') AND target_message_id IS NOT NULL)
    );

CREATE TABLE direct_chat_encrypted_message_pins_v2 (
    chat_id UUID NOT NULL REFERENCES direct_chats (id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES direct_chat_encrypted_messages_v2 (id) ON DELETE CASCADE,
    pinned_by_user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (chat_id, message_id)
);

CREATE INDEX idx_direct_chat_encrypted_message_pins_v2_chat_id
    ON direct_chat_encrypted_message_pins_v2 (chat_id, created_at DESC, message_id DESC);

CREATE TABLE group_encrypted_message_pins_v1 (
    group_id UUID NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES group_encrypted_messages_v1 (id) ON DELETE CASCADE,
    pinned_by_user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (group_id, message_id)
);

CREATE INDEX idx_group_encrypted_message_pins_v1_group_id
    ON group_encrypted_message_pins_v1 (group_id, created_at DESC, message_id DESC);
