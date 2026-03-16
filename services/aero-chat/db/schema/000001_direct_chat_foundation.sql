CREATE TABLE direct_chats (
    id UUID PRIMARY KEY,
    created_by_user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    user_low_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    user_high_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (user_low_id, user_high_id),
    CONSTRAINT direct_chats_not_self CHECK (user_low_id <> user_high_id),
    CONSTRAINT direct_chats_pair_members CHECK (
        created_by_user_id = user_low_id OR created_by_user_id = user_high_id
    )
);

CREATE INDEX idx_direct_chats_updated_at ON direct_chats (updated_at DESC, id DESC);

CREATE TABLE direct_chat_participants (
    chat_id UUID NOT NULL REFERENCES direct_chats (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    joined_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX idx_direct_chat_participants_user_id ON direct_chat_participants (user_id, joined_at DESC);

CREATE TABLE direct_chat_messages (
    id UUID PRIMARY KEY,
    chat_id UUID NOT NULL REFERENCES direct_chats (id) ON DELETE CASCADE,
    sender_user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    kind TEXT NOT NULL,
    text_content TEXT NOT NULL,
    markdown_policy TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT direct_chat_messages_kind CHECK (kind IN ('text')),
    CONSTRAINT direct_chat_messages_markdown_policy CHECK (markdown_policy IN ('safe_subset_v1'))
);

CREATE INDEX idx_direct_chat_messages_chat_id ON direct_chat_messages (chat_id, created_at DESC, id DESC);
CREATE INDEX idx_direct_chat_messages_sender_user_id ON direct_chat_messages (sender_user_id, created_at DESC);

CREATE TABLE direct_chat_message_tombstones (
    message_id UUID PRIMARY KEY REFERENCES direct_chat_messages (id) ON DELETE CASCADE,
    chat_id UUID NOT NULL REFERENCES direct_chats (id) ON DELETE CASCADE,
    deleted_by_user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    deleted_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_direct_chat_message_tombstones_chat_id ON direct_chat_message_tombstones (chat_id, deleted_at DESC);

CREATE TABLE direct_chat_pins (
    chat_id UUID NOT NULL REFERENCES direct_chats (id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES direct_chat_messages (id) ON DELETE CASCADE,
    pinned_by_user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (chat_id, message_id)
);

CREATE INDEX idx_direct_chat_pins_chat_id ON direct_chat_pins (chat_id, created_at DESC);
