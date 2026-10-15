-- name: ClaimChatAuthorityDelivery :one
WITH candidate AS (
    SELECT d.event_id FROM chat_revocation_delivery d
    JOIN chat_authority_revocation_outbox e ON e.event_id=d.event_id
    WHERE d.state='pending' AND d.next_attempt_at<=clock_timestamp()
        AND (d.claim_until IS NULL OR d.claim_until<=clock_timestamp())
        AND d.attempt<9223372036854775807 AND d.claim_fence<9223372036854775807
    ORDER BY e.occurred_at,e.event_id LIMIT 1 FOR UPDATE OF d SKIP LOCKED
), claimed AS (
    UPDATE chat_revocation_delivery d
    SET attempt=d.attempt+1,claim_fence=d.claim_fence+1,
        claim_owner=sqlc.arg(owner_id),claim_until=clock_timestamp()+interval '15 seconds'
    FROM candidate c WHERE d.event_id=c.event_id
    RETURNING d.event_id,d.attempt,d.claim_fence
)
SELECT c.*,e.group_id,e.user_id,e.source_revision,e.reason
FROM claimed c JOIN chat_authority_revocation_outbox e ON e.event_id=c.event_id;

-- name: HasExhaustedChatAuthorityDelivery :one
SELECT EXISTS(
    SELECT 1 FROM chat_revocation_delivery
    WHERE state='pending' AND next_attempt_at<=clock_timestamp()
        AND (attempt=9223372036854775807 OR claim_fence=9223372036854775807)
    LIMIT 1
);

-- name: CompleteChatAuthorityDelivery :execrows
UPDATE chat_revocation_delivery
SET state='delivered',operation_id=sqlc.arg(operation_id),
    registry_media_effect=sqlc.arg(media_effect),affected_registry_grants=sqlc.arg(grant_count),
    received_at=clock_timestamp()
WHERE event_id=sqlc.arg(event_id) AND state='pending'
    AND claim_owner=sqlc.arg(owner_id) AND claim_fence=sqlc.arg(fence)
    AND claim_until>clock_timestamp();

-- name: QuarantineChatAuthorityDelivery :execrows
UPDATE chat_revocation_delivery SET state='quarantined',quarantine_reason=sqlc.arg(reason)
WHERE event_id=sqlc.arg(event_id) AND state='pending'
    AND claim_owner=sqlc.arg(owner_id) AND claim_fence=sqlc.arg(fence)
    AND claim_until>clock_timestamp();

-- name: RetryChatAuthorityDelivery :execrows
UPDATE chat_revocation_delivery
SET claim_owner=NULL,claim_until=NULL,
    next_attempt_at=clock_timestamp()+make_interval(secs=>sqlc.arg(retry_seconds)::double precision)
WHERE event_id=sqlc.arg(event_id) AND state='pending'
    AND claim_owner=sqlc.arg(owner_id) AND claim_fence=sqlc.arg(fence)
    AND claim_until>clock_timestamp();
