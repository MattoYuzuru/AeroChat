ALTER TABLE direct_chat_messages
    ADD COLUMN reply_to_message_id UUID;

CREATE INDEX idx_direct_chat_messages_reply_to_message_id
    ON direct_chat_messages (reply_to_message_id)
    WHERE reply_to_message_id IS NOT NULL;

ALTER TABLE group_messages
    ADD COLUMN reply_to_message_id UUID;

CREATE INDEX idx_group_messages_reply_to_message_id
    ON group_messages (reply_to_message_id)
    WHERE reply_to_message_id IS NOT NULL;
