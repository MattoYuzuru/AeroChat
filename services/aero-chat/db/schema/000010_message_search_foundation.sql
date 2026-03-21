ALTER TABLE direct_chat_messages
    ADD COLUMN search_vector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('simple', COALESCE(text_content, ''))
    ) STORED;

CREATE INDEX idx_direct_chat_messages_search_vector
    ON direct_chat_messages
    USING GIN (search_vector)
    WHERE btrim(text_content) <> '';

ALTER TABLE group_messages
    ADD COLUMN search_vector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('simple', COALESCE(text_content, ''))
    ) STORED;

CREATE INDEX idx_group_messages_search_vector
    ON group_messages
    USING GIN (search_vector)
    WHERE btrim(text_content) <> '';
