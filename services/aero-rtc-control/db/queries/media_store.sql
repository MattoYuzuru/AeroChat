-- name: EnsureMediaUserMutex :exec
INSERT INTO rtc_media_user_generations(user_id) VALUES($1) ON CONFLICT DO NOTHING;

-- name: LockMediaUserMutex :one
SELECT * FROM rtc_media_user_generations WHERE user_id=$1 FOR UPDATE;

-- name: AllocateMediaGrantGeneration :one
UPDATE rtc_media_user_generations SET next_generation=next_generation+1
WHERE user_id=$1 AND next_generation<9223372036854775807 RETURNING (next_generation-1)::bigint AS generation;

-- name: GetHeldMediaRoom :one
SELECT * FROM rtc_media_rooms WHERE call_id=$1 AND state<>'closed' FOR UPDATE;

-- name: NextMediaRoomGeneration :one
SELECT (COALESCE(MAX(room_generation),0)+1)::bigint AS generation FROM rtc_media_rooms WHERE call_id=$1;

-- name: CreateMediaRoom :one
INSERT INTO rtc_media_rooms(id,call_id,group_id,room_generation,room_name,state,created_at)
VALUES($1,$2,$3,$4,$5,'prepared',$6) RETURNING *;

-- name: GetMediaGrant :one
SELECT g.*,r.room_name,r.room_generation FROM rtc_media_grants g JOIN rtc_media_rooms r ON r.id=g.room_id WHERE g.id=$1;

-- name: GetMediaGrantByRequest :one
SELECT g.*,r.room_name,r.room_generation FROM rtc_media_grants g JOIN rtc_media_rooms r ON r.id=g.room_id WHERE g.request_id=$1;

-- name: GetHeldMediaGrantByUser :one
SELECT g.*,r.room_name,r.room_generation FROM rtc_media_grants g JOIN rtc_media_rooms r ON r.id=g.room_id WHERE g.user_id=$1 AND g.state<>'revoked';

-- name: MediaAuthorityDenied :one
SELECT EXISTS (
    SELECT 1 FROM rtc_media_deny_watermarks
    WHERE user_id=sqlc.arg(user_id) AND (
        (kind='session' AND subject_id=sqlc.arg(session_id) AND device_id=sqlc.arg(device_id) AND source_revision>=sqlc.arg(session_revision)) OR
        (kind='device' AND subject_id=sqlc.arg(device_id) AND source_revision>=sqlc.arg(device_revision)) OR
        (kind='group' AND subject_id=sqlc.arg(group_id) AND source_revision>=sqlc.arg(eligibility_epoch))
    )
)::boolean AS denied;

-- name: CreateMediaGrant :one
INSERT INTO rtc_media_grants(id,request_id,room_id,call_id,participant_id,group_id,user_id,session_id,device_id,session_revision,device_revision,eligibility_epoch,grant_generation,participant_identity,state,prepared_at,prepare_deadline)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'prepared',sqlc.arg(prepared_at)::timestamptz,sqlc.arg(prepared_at)::timestamptz+interval '20 seconds') RETURNING *;

-- name: ActivateMediaGrant :execrows
UPDATE rtc_media_grants SET state='active',activation_intent_at=COALESCE(activation_intent_at,$2)
WHERE id=$1 AND state IN ('prepared','active') AND (state='active' OR prepare_deadline>$2);

-- name: ActivateMediaRoom :exec
UPDATE rtc_media_rooms SET state='active' WHERE id=$1 AND state='prepared';

-- name: GetHeldMediaLease :one
SELECT * FROM rtc_media_connection_leases WHERE grant_id=$1 AND state<>'closed';

-- name: GetMediaLease :one
SELECT * FROM rtc_media_connection_leases WHERE id=$1;

-- name: CreateMediaLease :one
INSERT INTO rtc_media_connection_leases(id,grant_id,owner_id,owner_fence,state,connected_at)
VALUES($1,$2,$3,$4,'open',$5) RETURNING *;

-- name: CloseMediaLease :execrows
UPDATE rtc_media_connection_leases SET state='closed',closed_at=$4
WHERE id=$1 AND owner_id=$2 AND owner_fence=$3 AND state<>'closed';

-- name: GetMediaOperation :one
SELECT * FROM rtc_media_operations WHERE id=$1;

-- name: GetMediaOperationByOrigin :one
SELECT * FROM rtc_media_operations WHERE origin_domain=$1 AND origin_id=$2;

-- name: CreateMediaOperation :one
INSERT INTO rtc_media_operations(id,origin_domain,origin_id,user_id,reason,authority_outcome,media_state,created_at,completed_at)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *;

-- name: GetMediaSourceEvent :one
SELECT * FROM rtc_media_source_inbox WHERE origin_domain=$1 AND event_id=$2;

-- name: CreateMediaSourceEvent :exec
INSERT INTO rtc_media_source_inbox(origin_domain,event_id,kind,subject_id,user_id,device_id,source_revision,operation_id,received_at)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9);

-- name: AdvanceMediaDenyWatermark :exec
INSERT INTO rtc_media_deny_watermarks(kind,subject_id,user_id,device_id,source_revision) VALUES($1,$2,$3,$4,$5)
ON CONFLICT(kind,subject_id,user_id,device_id) DO UPDATE SET source_revision=GREATEST(rtc_media_deny_watermarks.source_revision,EXCLUDED.source_revision);

-- name: BeginMediaGrantRevoke :execrows
UPDATE rtc_media_grants SET state='revoking',operation_id=$2 WHERE id=$1 AND state IN ('prepared','active');

-- name: BeginMediaLeaseClose :exec
UPDATE rtc_media_connection_leases SET state='closing' WHERE grant_id=$1 AND state='open';

-- name: CreateMediaOperationTarget :exec
INSERT INTO rtc_media_operation_targets(operation_id,grant_id,room_id,room_name,room_generation,participant_identity,grant_generation,lease_id,expected_owner_id,expected_owner_fence)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);

-- name: GetMediaOperationTarget :one
SELECT * FROM rtc_media_operation_targets WHERE operation_id=$1 AND grant_id=$2;

-- name: CreateMediaCleanupAction :exec
INSERT INTO rtc_media_cleanup_outbox(operation_id,grant_id,action,retry_at) VALUES($1,$2,$3,$4);

-- name: ClaimMediaCleanupAction :one
UPDATE rtc_media_cleanup_outbox SET state='claimed',claim_owner=$4,claim_fence=claim_fence+1,claim_until=$6,attempts=attempts+1
WHERE operation_id=$1 AND grant_id=$2 AND action=$3 AND retry_at<=$5
AND claim_fence<9223372036854775807 AND attempts<9223372036854775807
AND (state='pending' OR (state='claimed' AND claim_until<=$5)) RETURNING *;

-- name: AckMediaCleanupAction :execrows
UPDATE rtc_media_cleanup_outbox SET state='acked',acked_at=$6
WHERE operation_id=$1 AND grant_id=$2 AND action=$3 AND state='claimed'
AND claim_owner=$4 AND claim_fence=$5 AND claim_until>=$6;

-- name: GetMediaCleanupAction :one
SELECT * FROM rtc_media_cleanup_outbox WHERE operation_id=$1 AND grant_id=$2 AND action=$3;

-- name: RetryMediaCleanupAction :execrows
UPDATE rtc_media_cleanup_outbox SET state='pending',retry_at=$6,last_error=$7,claim_until=NULL
WHERE operation_id=$1 AND grant_id=$2 AND action=$3 AND state='claimed' AND claim_owner=$4 AND claim_fence=$5;

-- name: HasPendingMediaCleanup :one
SELECT EXISTS(SELECT 1 FROM rtc_media_cleanup_outbox WHERE operation_id=$1 AND state<>'acked')::boolean;

-- name: FinishMediaGrantRevoke :execrows
UPDATE rtc_media_grants SET state='revoked',revoked_at=$3 WHERE id=$1 AND operation_id=$2 AND state='revoking';

-- name: FinishMediaOperation :exec
UPDATE rtc_media_operations SET media_state='complete',completed_at=$2 WHERE id=$1 AND media_state='pending';

-- name: CountHeldMediaRoomGrants :one
SELECT COUNT(*)::bigint FROM rtc_media_grants WHERE room_id=$1 AND state<>'revoked';

-- name: FinishMediaRoom :exec
UPDATE rtc_media_rooms SET state='closed',closed_at=$2 WHERE id=$1 AND state<>'closed';

-- name: GetMediaOperationGrantIDs :many
SELECT grant_id FROM rtc_media_operation_targets WHERE operation_id=$1 ORDER BY grant_id;

-- name: ExpireNeverActivatedMediaGrant :execrows
UPDATE rtc_media_grants SET state='revoked',revoked_at=$3,operation_id=$2
WHERE rtc_media_grants.id=$1 AND state='prepared' AND activation_intent_at IS NULL AND prepare_deadline<=$3
AND NOT EXISTS (SELECT 1 FROM rtc_media_connection_leases WHERE grant_id=$1);

-- name: MarkMediaOperationAuthorityRevoked :exec
UPDATE rtc_media_operations SET authority_outcome='revoked' WHERE id=$1;

-- name: LockMediaRoom :one
SELECT * FROM rtc_media_rooms WHERE id=$1 FOR UPDATE;
