-- name: ListSlotParticipationsByUser :many
SELECT * FROM rtc_call_participants WHERE user_id=$1 AND state='active' ORDER BY call_id,id;

-- name: GetSlotParticipant :one
SELECT * FROM rtc_call_participants WHERE id=$1;

-- name: ListHeldMediaGrantsByCall :many
SELECT g.*,r.room_name,r.room_generation FROM rtc_media_grants g
JOIN rtc_media_rooms r ON r.id=g.room_id WHERE g.call_id=$1 AND g.state<>'revoked' ORDER BY g.user_id;

-- name: FindHeldMediaRoomByCall :one
SELECT * FROM rtc_media_rooms WHERE call_id=$1 AND state<>'closed';
