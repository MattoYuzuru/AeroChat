CREATE TABLE attachments (
    id UUID PRIMARY KEY,
    owner_user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    scope_kind TEXT NOT NULL,
    direct_chat_id UUID REFERENCES direct_chats (id) ON DELETE CASCADE,
    group_id UUID REFERENCES groups (id) ON DELETE CASCADE,
    bucket_name TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    uploaded_at TIMESTAMPTZ,
    attached_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT attachments_scope_kind CHECK (scope_kind IN ('direct', 'group')),
    CONSTRAINT attachments_status CHECK (status IN ('pending', 'uploaded', 'attached', 'failed', 'deleted')),
    CONSTRAINT attachments_scope_ref CHECK (
        (scope_kind = 'direct' AND direct_chat_id IS NOT NULL AND group_id IS NULL)
        OR (scope_kind = 'group' AND group_id IS NOT NULL AND direct_chat_id IS NULL)
    ),
    CONSTRAINT attachments_file_name_not_blank CHECK (btrim(file_name) <> ''),
    CONSTRAINT attachments_mime_type_not_blank CHECK (btrim(mime_type) <> ''),
    CONSTRAINT attachments_bucket_name_not_blank CHECK (btrim(bucket_name) <> ''),
    CONSTRAINT attachments_object_key_not_blank CHECK (btrim(object_key) <> ''),
    CONSTRAINT attachments_size_bytes_positive CHECK (size_bytes > 0)
);

CREATE INDEX idx_attachments_owner_status
    ON attachments (owner_user_id, status, created_at DESC, id DESC);

CREATE INDEX idx_attachments_direct_chat
    ON attachments (direct_chat_id, created_at DESC, id DESC)
    WHERE direct_chat_id IS NOT NULL;

CREATE INDEX idx_attachments_group
    ON attachments (group_id, created_at DESC, id DESC)
    WHERE group_id IS NOT NULL;

CREATE TABLE attachment_upload_sessions (
    id UUID PRIMARY KEY,
    attachment_id UUID NOT NULL UNIQUE REFERENCES attachments (id) ON DELETE CASCADE,
    owner_user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    status TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    CONSTRAINT attachment_upload_sessions_status CHECK (status IN ('pending', 'completed', 'failed', 'expired'))
);

CREATE INDEX idx_attachment_upload_sessions_owner_status
    ON attachment_upload_sessions (owner_user_id, status, created_at DESC, id DESC);

CREATE TABLE message_attachments (
    attachment_id UUID PRIMARY KEY REFERENCES attachments (id) ON DELETE CASCADE,
    direct_chat_message_id UUID REFERENCES direct_chat_messages (id) ON DELETE CASCADE,
    group_message_id UUID REFERENCES group_messages (id) ON DELETE CASCADE,
    attached_by_user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT message_attachments_message_ref CHECK (
        (direct_chat_message_id IS NOT NULL AND group_message_id IS NULL)
        OR (group_message_id IS NOT NULL AND direct_chat_message_id IS NULL)
    )
);

CREATE INDEX idx_message_attachments_direct_chat_message
    ON message_attachments (direct_chat_message_id, created_at ASC)
    WHERE direct_chat_message_id IS NOT NULL;

CREATE INDEX idx_message_attachments_group_message
    ON message_attachments (group_message_id, created_at ASC)
    WHERE group_message_id IS NOT NULL;
