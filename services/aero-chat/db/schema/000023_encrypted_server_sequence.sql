ALTER TABLE direct_chats
    ADD COLUMN encrypted_server_sequence BIGINT NOT NULL DEFAULT 0
        CHECK (encrypted_server_sequence >= 0);
ALTER TABLE groups
    ADD COLUMN encrypted_server_sequence BIGINT NOT NULL DEFAULT 0
        CHECK (encrypted_server_sequence >= 0);

-- Старые rows мигрируются только явным maintenance CLI после остановки writers.
ALTER TABLE direct_chat_encrypted_messages_v2
    ADD COLUMN server_sequence BIGINT CHECK (server_sequence > 0),
    DROP CONSTRAINT direct_chat_encrypted_messages_v2_stored_after_create;
ALTER TABLE group_encrypted_messages_v1
    ADD COLUMN server_sequence BIGINT CHECK (server_sequence > 0),
    DROP CONSTRAINT group_encrypted_messages_v1_stored_after_create;
CREATE UNIQUE INDEX idx_direct_encrypted_server_sequence
    ON direct_chat_encrypted_messages_v2 (chat_id, server_sequence DESC);
CREATE UNIQUE INDEX idx_group_encrypted_server_sequence
    ON group_encrypted_messages_v1 (group_id, server_sequence DESC);
CREATE INDEX idx_direct_encrypted_unassigned_sequence
    ON direct_chat_encrypted_messages_v2 (chat_id, created_at, id)
    WHERE server_sequence IS NULL;
CREATE INDEX idx_group_encrypted_unassigned_sequence
    ON group_encrypted_messages_v1 (group_id, created_at, id)
    WHERE server_sequence IS NULL;

ALTER TABLE direct_chat_encrypted_read_states_v1
    ADD COLUMN last_read_server_sequence BIGINT NOT NULL DEFAULT 0
        CHECK (last_read_server_sequence >= 0);
ALTER TABLE group_encrypted_read_states_v1
    ADD COLUMN last_read_server_sequence BIGINT NOT NULL DEFAULT 0
        CHECK (last_read_server_sequence >= 0);
