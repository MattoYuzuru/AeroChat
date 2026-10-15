-- name: CreateAuthorityRevocationEvent :exec
INSERT INTO identity_authority_revocation_outbox (
    id, subject_kind, subject_id, user_id, device_id, session_id,
    source_revision, occurred_at, reason
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
