CREATE TABLE rtc_admission_fence (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    last_fence BIGINT NOT NULL CHECK (last_fence >= 0)
);
INSERT INTO rtc_admission_fence(singleton,last_fence) VALUES(TRUE,0);

CREATE TABLE rtc_admission_instances (
    leaf_fingerprint BYTEA PRIMARY KEY CHECK (octet_length(leaf_fingerprint)=32),
    instance_id UUID NOT NULL UNIQUE CHECK (instance_id <> '00000000-0000-0000-0000-000000000000'),
    request_id UUID NOT NULL CHECK (request_id <> '00000000-0000-0000-0000-000000000000'),
    registration_fence BIGINT NOT NULL UNIQUE CHECK (registration_fence > 0),
    state TEXT NOT NULL CHECK (state IN ('active','draining','retired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Исторический leaf не регистрируется заново; immutable binding не меняется.
CREATE FUNCTION guard_admission_instance_history() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'registration history is retained' USING ERRCODE='23514';
    END IF;
    IF NEW.leaf_fingerprint IS DISTINCT FROM OLD.leaf_fingerprint
        OR NEW.instance_id IS DISTINCT FROM OLD.instance_id
        OR NEW.request_id IS DISTINCT FROM OLD.request_id
        OR NEW.registration_fence IS DISTINCT FROM OLD.registration_fence
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR (OLD.state='retired' AND NEW.state<>'retired')
        OR (OLD.state='draining' AND NEW.state='active') THEN
        RAISE EXCEPTION 'registration binding or retired state is immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER admission_instance_history_guard
BEFORE UPDATE OR DELETE ON rtc_admission_instances
FOR EACH ROW EXECUTE FUNCTION guard_admission_instance_history();
