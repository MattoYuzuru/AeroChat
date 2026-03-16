CREATE TABLE direct_chat_read_receipts (
    chat_id UUID NOT NULL REFERENCES direct_chats (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    last_read_message_id UUID NOT NULL REFERENCES direct_chat_messages (id) ON DELETE CASCADE,
    last_read_message_created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX idx_direct_chat_read_receipts_chat_id
    ON direct_chat_read_receipts (chat_id, updated_at DESC);

CREATE INDEX idx_direct_chat_read_receipts_user_id
    ON direct_chat_read_receipts (user_id, updated_at DESC);
