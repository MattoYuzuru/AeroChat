ALTER TABLE message_attachments
    DROP CONSTRAINT message_attachments_message_ref;

ALTER TABLE message_attachments
    ADD COLUMN encrypted_direct_message_v2_id UUID REFERENCES direct_chat_encrypted_messages_v2 (id) ON DELETE CASCADE,
    ADD COLUMN encrypted_group_message_v1_id UUID REFERENCES group_encrypted_messages_v1 (id) ON DELETE CASCADE;

ALTER TABLE message_attachments
    ADD CONSTRAINT message_attachments_message_ref CHECK (
        (
            CASE WHEN direct_chat_message_id IS NULL THEN 0 ELSE 1 END
            + CASE WHEN group_message_id IS NULL THEN 0 ELSE 1 END
            + CASE WHEN encrypted_direct_message_v2_id IS NULL THEN 0 ELSE 1 END
            + CASE WHEN encrypted_group_message_v1_id IS NULL THEN 0 ELSE 1 END
        ) = 1
    );

CREATE INDEX idx_message_attachments_encrypted_direct_message_v2
    ON message_attachments (encrypted_direct_message_v2_id, created_at ASC)
    WHERE encrypted_direct_message_v2_id IS NOT NULL;

CREATE INDEX idx_message_attachments_encrypted_group_message_v1
    ON message_attachments (encrypted_group_message_v1_id, created_at ASC)
    WHERE encrypted_group_message_v1_id IS NOT NULL;
