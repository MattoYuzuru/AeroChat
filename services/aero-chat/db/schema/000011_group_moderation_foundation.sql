ALTER TABLE group_memberships
    ADD COLUMN is_write_restricted BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN write_restricted_at TIMESTAMPTZ,
    ADD CONSTRAINT group_memberships_write_restriction_consistency CHECK (
        (is_write_restricted = FALSE AND write_restricted_at IS NULL)
        OR (is_write_restricted = TRUE AND write_restricted_at IS NOT NULL)
    );
