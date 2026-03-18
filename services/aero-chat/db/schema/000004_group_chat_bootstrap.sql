CREATE TABLE group_threads (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    thread_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT group_threads_thread_key_not_blank CHECK (btrim(thread_key) <> '')
);

CREATE UNIQUE INDEX idx_group_threads_group_thread_key
    ON group_threads (group_id, thread_key);

CREATE UNIQUE INDEX idx_group_threads_unique_primary_per_group
    ON group_threads (group_id)
    WHERE thread_key = 'primary';

CREATE INDEX idx_group_threads_updated_at
    ON group_threads (updated_at DESC, id DESC);

CREATE TABLE group_messages (
    id UUID PRIMARY KEY,
    thread_id UUID NOT NULL REFERENCES group_threads (id) ON DELETE CASCADE,
    sender_user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    kind TEXT NOT NULL,
    text_content TEXT NOT NULL,
    markdown_policy TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT group_messages_kind CHECK (kind IN ('text')),
    CONSTRAINT group_messages_markdown_policy CHECK (markdown_policy IN ('safe_subset_v1')),
    CONSTRAINT group_messages_text_content_not_blank CHECK (btrim(text_content) <> '')
);

CREATE INDEX idx_group_messages_thread_created_at
    ON group_messages (thread_id, created_at DESC, id DESC);
