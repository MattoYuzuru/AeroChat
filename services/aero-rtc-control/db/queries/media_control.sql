-- name: GetOpenMediaEndByCall :one
SELECT * FROM rtc_media_control_intents WHERE call_id=$1 AND kind='end' AND state='pending';

-- name: GetOpenMediaEndByGroup :one
SELECT * FROM rtc_media_control_intents WHERE group_id=$1 AND kind='end' AND state='pending' ORDER BY created_at,id LIMIT 1;

-- name: GetOpenMediaEndForActiveUser :one
SELECT i.* FROM rtc_media_control_intents i JOIN rtc_call_participants p ON p.call_id=i.call_id
WHERE p.user_id=$1 AND p.state='active' AND i.kind='end' AND i.state='pending' ORDER BY i.created_at,i.id LIMIT 1;

-- name: GetMediaControlIntent :one
SELECT * FROM rtc_media_control_intents WHERE id=$1;

-- name: GetMediaControlByRequest :one
SELECT * FROM rtc_media_control_intents WHERE actor_user_id=$1 AND request_id=$2;

-- name: CreateMediaControlIntent :one
INSERT INTO rtc_media_control_intents(id,request_id,actor_user_id,actor_session_id,actor_device_id,actor_session_revision,actor_device_revision,call_id,group_id,kind,resolution,created_at)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *;

-- name: CreateMediaControlChild :execrows
INSERT INTO rtc_media_control_children(parent_id,operation_id,grant_id,room_id,room_name,room_generation,participant_identity,grant_generation,call_id,participant_id,user_id,session_id,device_id,session_revision,device_revision,eligibility_epoch,lease_id,expected_owner_id,expected_owner_fence)
SELECT sqlc.arg(parent_id),t.operation_id,g.id,t.room_id,t.room_name,t.room_generation,t.participant_identity,t.grant_generation,g.call_id,g.participant_id,g.user_id,g.session_id,g.device_id,g.session_revision,g.device_revision,g.eligibility_epoch,t.lease_id,t.expected_owner_id,t.expected_owner_fence
FROM rtc_media_grants g JOIN rtc_media_operation_targets t ON t.grant_id=g.id AND t.operation_id=g.operation_id WHERE g.id=sqlc.arg(grant_id);

-- name: CreateMediaControlParticipant :exec
INSERT INTO rtc_media_control_participants(parent_id,participant_id,call_id,user_id) VALUES($1,$2,$3,$4);

-- name: CreateMediaControlRoom :exec
INSERT INTO rtc_media_control_rooms(parent_id,room_id,room_name,room_generation,call_id,retry_at) VALUES($1,$2,$3,$4,$5,$6);

-- name: ListMediaControlChildren :many
SELECT * FROM rtc_media_control_children WHERE parent_id=$1 ORDER BY user_id,grant_id;

-- name: ListMediaControlRooms :many
SELECT * FROM rtc_media_control_rooms WHERE parent_id=$1 ORDER BY room_id;

-- name: ListMediaControlParticipants :many
SELECT * FROM rtc_media_control_participants WHERE parent_id=$1 ORDER BY user_id,participant_id;

-- name: ListOpenMediaRoomsByCall :many
SELECT * FROM rtc_media_rooms WHERE call_id=$1 AND state<>'closed' ORDER BY id;

-- name: BeginMediaRoomControlClose :execrows
UPDATE rtc_media_rooms SET state='closing' WHERE id=$1 AND state IN ('prepared','active','closing');

-- name: ClaimMediaControlRoom :one
UPDATE rtc_media_control_rooms SET state='claimed',claim_owner=$3,claim_fence=claim_fence+1,attempts=attempts+1,claim_until=clock_timestamp()+interval '15 seconds'
WHERE parent_id=$1 AND room_id=$2 AND retry_at<=clock_timestamp()
AND claim_fence<9223372036854775807 AND attempts<9223372036854775807
AND (state='pending' OR (state='claimed' AND claim_until<=clock_timestamp())) RETURNING *;

-- name: GetMediaControlRoom :one
SELECT * FROM rtc_media_control_rooms WHERE parent_id=$1 AND room_id=$2;

-- name: AckMediaControlRoom :execrows
UPDATE rtc_media_control_rooms SET state='acked',acked_at=clock_timestamp()
WHERE parent_id=$1 AND room_id=$2 AND state='claimed' AND claim_owner=$3 AND claim_fence=$4 AND claim_until>=clock_timestamp();

-- name: FinishMediaControlIntent :execrows
UPDATE rtc_media_control_intents SET state='complete',completed_at=$2 WHERE id=$1 AND state='pending' AND resolution='known';

-- name: HasHeldMediaLeasesByCall :one
SELECT EXISTS(SELECT 1 FROM rtc_media_connection_leases l JOIN rtc_media_grants g ON g.id=l.grant_id WHERE g.call_id=$1 AND l.state<>'closed')::boolean;

-- name: MediaControlChildrenReady :one
SELECT NOT EXISTS(
 SELECT 1 FROM rtc_media_control_children c
 JOIN rtc_media_grants g ON g.id=c.grant_id JOIN rtc_media_operations o ON o.id=c.operation_id
 WHERE c.parent_id=$1 AND (g.state<>'revoked' OR g.operation_id IS DISTINCT FROM c.operation_id OR o.media_state<>'complete'
 OR EXISTS(SELECT 1 FROM rtc_media_cleanup_outbox a WHERE a.operation_id=c.operation_id AND a.state<>'acked'))
)::boolean;

-- name: RetryMediaControlRoom :execrows
UPDATE rtc_media_control_rooms SET state='pending',claim_until=NULL,last_error=$5,retry_at=$6
WHERE parent_id=$1 AND room_id=$2 AND state='claimed' AND claim_owner=$3 AND claim_fence=$4 AND claim_until>=clock_timestamp();
