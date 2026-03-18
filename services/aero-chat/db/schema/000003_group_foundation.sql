CREATE TABLE groups (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    created_by_user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT groups_name_not_blank CHECK (btrim(name) <> '')
);

CREATE INDEX idx_groups_updated_at ON groups (updated_at DESC, id DESC);

CREATE TABLE group_memberships (
    group_id UUID NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    role TEXT NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (group_id, user_id),
    CONSTRAINT group_memberships_role CHECK (role IN ('owner', 'admin', 'member', 'reader'))
);

CREATE INDEX idx_group_memberships_user_id
    ON group_memberships (user_id, joined_at DESC, group_id DESC);

CREATE UNIQUE INDEX idx_group_memberships_unique_owner
    ON group_memberships (group_id)
    WHERE role = 'owner';

CREATE TABLE group_invite_links (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    created_by_user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    role TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    join_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    disabled_at TIMESTAMPTZ,
    last_joined_at TIMESTAMPTZ,
    CONSTRAINT group_invite_links_role CHECK (role IN ('admin', 'member', 'reader')),
    CONSTRAINT group_invite_links_join_count_non_negative CHECK (join_count >= 0)
);

CREATE INDEX idx_group_invite_links_group_id
    ON group_invite_links (group_id, created_at DESC, id DESC);
