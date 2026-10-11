CREATE TABLE group_membership_authority_versions (
    group_id UUID NOT NULL,
    user_id UUID NOT NULL,
    revision BIGINT NOT NULL CHECK (revision > 0),
    present BOOLEAN NOT NULL,
    eligible BOOLEAN NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id),
    CHECK (present OR NOT eligible),
    CHECK (NOT eligible OR revision < 9223372036854775807)
);

CREATE TABLE chat_authority_revocation_outbox (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL,
    user_id UUID NOT NULL,
    source_revision BIGINT NOT NULL CHECK (source_revision > 0),
    reason TEXT NOT NULL CHECK (reason IN ('eligibility_denied', 'member_removed')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (group_id, user_id, source_revision)
);

-- Tombstone и pending events сохраняются после удаления исходных rows.
INSERT INTO group_membership_authority_versions (group_id, user_id, revision, present, eligible)
SELECT group_id, user_id, 1, TRUE, role IN ('owner', 'admin', 'member')
FROM group_memberships;

CREATE FUNCTION capture_group_membership_authority() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
    subject_group UUID;
    subject_user UUID;
    prior_revision BIGINT;
    prior_present BOOLEAN;
    prior_eligible BOOLEAN;
    next_present BOOLEAN;
    next_eligible BOOLEAN;
    next_revision BIGINT;
    event_reason TEXT;
BEGIN
    IF TG_OP = 'UPDATE' AND (OLD.group_id <> NEW.group_id OR OLD.user_id <> NEW.user_id) THEN
        RAISE EXCEPTION 'membership authority binding is immutable' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        subject_group := OLD.group_id;
        subject_user := OLD.user_id;
        next_present := FALSE;
        next_eligible := FALSE;
    ELSE
        subject_group := NEW.group_id;
        subject_user := NEW.user_id;
        next_present := TRUE;
        next_eligible := NEW.role IN ('owner', 'admin', 'member');
    END IF;

    -- AFTER trigger уже имеет child row lock; parent/user locks здесь не берутся.
    EXECUTE format('SELECT revision, present, eligible FROM %I.group_membership_authority_versions WHERE group_id = $1 AND user_id = $2 FOR UPDATE', TG_TABLE_SCHEMA)
        INTO prior_revision, prior_present, prior_eligible USING subject_group, subject_user;
    IF prior_revision IS NULL THEN
        IF TG_OP <> 'INSERT' THEN
            RAISE EXCEPTION 'membership authority state is missing' USING ERRCODE = '23514';
        END IF;
        EXECUTE format('INSERT INTO %I.group_membership_authority_versions (group_id, user_id, revision, present, eligible) VALUES ($1, $2, 1, TRUE, $3)', TG_TABLE_SCHEMA)
            USING subject_group, subject_user, next_eligible;
        RETURN NULL;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF prior_present OR prior_eligible THEN
            RAISE EXCEPTION 'membership authority state is inconsistent' USING ERRCODE = '23514';
        END IF;
    ELSIF NOT prior_present OR prior_eligible IS DISTINCT FROM (OLD.role IN ('owner', 'admin', 'member')) THEN
        RAISE EXCEPTION 'membership authority state is inconsistent' USING ERRCODE = '23514';
    END IF;
    IF prior_present = next_present AND prior_eligible = next_eligible THEN
        RETURN NULL;
    END IF;
    IF prior_revision >= 9223372036854775807 THEN
        RAISE EXCEPTION 'membership authority revision exhausted' USING ERRCODE = '23514';
    END IF;
    next_revision := prior_revision + 1;
    EXECUTE format('UPDATE %I.group_membership_authority_versions SET revision = $3, present = $4, eligible = $5, updated_at = CURRENT_TIMESTAMP WHERE group_id = $1 AND user_id = $2', TG_TABLE_SCHEMA)
        USING subject_group, subject_user, next_revision, next_present, next_eligible;
    IF NOT next_present THEN
        event_reason := 'member_removed';
    ELSIF NOT next_eligible THEN
        event_reason := 'eligibility_denied';
    ELSE
        RETURN NULL;
    END IF;
    EXECUTE format('INSERT INTO %I.chat_authority_revocation_outbox (group_id, user_id, source_revision, reason) VALUES ($1, $2, $3, $4)', TG_TABLE_SCHEMA)
        USING subject_group, subject_user, next_revision, event_reason;
    RETURN NULL;
END;
$$;

CREATE TRIGGER group_membership_authority_capture
AFTER INSERT OR UPDATE OF role, group_id, user_id OR DELETE ON group_memberships
FOR EACH ROW EXECUTE FUNCTION capture_group_membership_authority();
