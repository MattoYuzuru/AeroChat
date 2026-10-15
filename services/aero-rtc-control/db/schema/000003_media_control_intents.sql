-- Registered additive coordinator foundation ADR097; public handler/SDK/ACK adapter не подключены.
CREATE TABLE rtc_media_control_intents (
 id UUID PRIMARY KEY,
 request_id UUID NOT NULL,
 actor_user_id UUID NOT NULL,
 actor_session_id UUID NOT NULL,
 actor_device_id UUID NOT NULL,
 actor_session_revision BIGINT NOT NULL CHECK(actor_session_revision>0 AND actor_session_revision<9223372036854775807),
 actor_device_revision BIGINT NOT NULL CHECK(actor_device_revision>0 AND actor_device_revision<9223372036854775807),
 call_id UUID NOT NULL REFERENCES rtc_calls(id) ON DELETE RESTRICT,
 group_id UUID NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('leave','end')),
 resolution TEXT NOT NULL CHECK(resolution IN ('known','unknown')),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','complete')),
 created_at TIMESTAMPTZ NOT NULL,
 completed_at TIMESTAMPTZ,
 UNIQUE(actor_user_id,request_id),
 CHECK((state='complete')=(completed_at IS NOT NULL)),
 CHECK(state<>'complete' OR resolution='known')
);
CREATE UNIQUE INDEX rtc_media_control_one_open_end ON rtc_media_control_intents(call_id) WHERE kind='end' AND state='pending';
CREATE INDEX rtc_media_control_open_group ON rtc_media_control_intents(group_id) WHERE kind='end' AND state='pending';

CREATE TABLE rtc_media_control_children (
 parent_id UUID NOT NULL REFERENCES rtc_media_control_intents(id) ON DELETE RESTRICT,
 operation_id UUID NOT NULL,
 grant_id UUID NOT NULL,
 room_id UUID NOT NULL,
 room_name UUID NOT NULL,
 room_generation BIGINT NOT NULL CHECK(room_generation>0),
 participant_identity UUID NOT NULL,
 grant_generation BIGINT NOT NULL CHECK(grant_generation>0),
 call_id UUID NOT NULL,
 participant_id UUID NOT NULL REFERENCES rtc_call_participants(id) ON DELETE RESTRICT,
 user_id UUID NOT NULL,
 session_id UUID NOT NULL,
 device_id UUID NOT NULL,
 session_revision BIGINT NOT NULL CHECK(session_revision>0),
 device_revision BIGINT NOT NULL CHECK(device_revision>0),
 eligibility_epoch BIGINT NOT NULL CHECK(eligibility_epoch>0),
 lease_id UUID,
 expected_owner_id UUID,
 expected_owner_fence BIGINT,
 PRIMARY KEY(parent_id,grant_id),
 FOREIGN KEY(operation_id,grant_id) REFERENCES rtc_media_operation_targets(operation_id,grant_id) ON DELETE RESTRICT,
 CHECK((lease_id IS NULL AND expected_owner_id IS NULL AND expected_owner_fence IS NULL) OR
       (lease_id IS NOT NULL AND expected_owner_id IS NOT NULL AND expected_owner_fence>0))
);

CREATE TABLE rtc_media_control_participants (
 parent_id UUID NOT NULL REFERENCES rtc_media_control_intents(id) ON DELETE RESTRICT,
 participant_id UUID NOT NULL REFERENCES rtc_call_participants(id) ON DELETE RESTRICT,
 call_id UUID NOT NULL REFERENCES rtc_calls(id) ON DELETE RESTRICT,
 user_id UUID NOT NULL,
 PRIMARY KEY(parent_id,participant_id)
);

CREATE TABLE rtc_media_control_rooms (
 parent_id UUID NOT NULL REFERENCES rtc_media_control_intents(id) ON DELETE RESTRICT,
 room_id UUID NOT NULL REFERENCES rtc_media_rooms(id) ON DELETE RESTRICT,
 room_name UUID NOT NULL,
 room_generation BIGINT NOT NULL CHECK(room_generation>0),
 call_id UUID NOT NULL REFERENCES rtc_calls(id) ON DELETE RESTRICT,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','claimed','acked')),
 claim_owner UUID,
 claim_fence BIGINT NOT NULL DEFAULT 0 CHECK(claim_fence>=0),
 claim_until TIMESTAMPTZ,
 attempts BIGINT NOT NULL DEFAULT 0 CHECK(attempts>=0),
 retry_at TIMESTAMPTZ NOT NULL,
 last_error TEXT NOT NULL DEFAULT '' CHECK(last_error IN ('','timeout','unavailable')),
 acked_at TIMESTAMPTZ,
 PRIMARY KEY(parent_id,room_id),
 CHECK(state<>'claimed' OR (claim_owner IS NOT NULL AND claim_fence>0 AND claim_until IS NOT NULL)),
 CHECK((state='acked')=(acked_at IS NOT NULL))
);

-- Pending history и snapshot не удаляются; UPDATE допускает лишь monotonic journal state.
CREATE FUNCTION rtc_media_control_preserve_history() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable media control history'; END IF;
 IF TG_TABLE_NAME='rtc_media_control_intents' THEN
  IF (to_jsonb(NEW)-ARRAY['state','completed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','completed_at']) OR
     (OLD.state='complete' AND NEW IS DISTINCT FROM OLD) THEN
   RAISE EXCEPTION 'immutable media control intent';
  END IF;
 ELSIF TG_TABLE_NAME='rtc_media_control_rooms' THEN
  IF (to_jsonb(NEW)-ARRAY['state','claim_owner','claim_fence','claim_until','attempts','retry_at','last_error','acked_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['state','claim_owner','claim_fence','claim_until','attempts','retry_at','last_error','acked_at']) OR
     NEW.claim_fence<OLD.claim_fence OR NEW.attempts<OLD.attempts OR (OLD.state='acked' AND NEW IS DISTINCT FROM OLD) THEN
   RAISE EXCEPTION 'immutable media control room';
  END IF;
 ELSE
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'immutable media control snapshot'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rtc_media_control_intent_history BEFORE UPDATE OR DELETE ON rtc_media_control_intents FOR EACH ROW EXECUTE FUNCTION rtc_media_control_preserve_history();
CREATE TRIGGER rtc_media_control_child_history BEFORE UPDATE OR DELETE ON rtc_media_control_children FOR EACH ROW EXECUTE FUNCTION rtc_media_control_preserve_history();
CREATE TRIGGER rtc_media_control_participant_history BEFORE UPDATE OR DELETE ON rtc_media_control_participants FOR EACH ROW EXECUTE FUNCTION rtc_media_control_preserve_history();
CREATE TRIGGER rtc_media_control_room_history BEFORE UPDATE OR DELETE ON rtc_media_control_rooms FOR EACH ROW EXECUTE FUNCTION rtc_media_control_preserve_history();
