ALTER TABLE direct_chat_messages
    ADD COLUMN edited_at TIMESTAMPTZ;

ALTER TABLE group_messages
    ADD COLUMN edited_at TIMESTAMPTZ;
