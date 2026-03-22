UPDATE crypto_device_link_intents
SET
    status = 'expired',
    expired_at = COALESCE(expired_at, CURRENT_TIMESTAMP)
WHERE status = 'pending';

ALTER TABLE crypto_device_link_intents
    ADD COLUMN approval_challenge BYTEA NULL;

UPDATE crypto_device_link_intents
SET approval_challenge = decode(md5(id::text || ':' || user_id::text || ':' || created_at::text), 'hex')
WHERE approval_challenge IS NULL;

ALTER TABLE crypto_device_link_intents
    ALTER COLUMN approval_challenge SET NOT NULL;

ALTER TABLE crypto_device_link_intents
    ADD CONSTRAINT crypto_device_link_intents_approval_challenge_nonempty
        CHECK (octet_length(approval_challenge) > 0),
    ADD CONSTRAINT crypto_device_link_intents_no_self_approval
        CHECK (
            approved_by_crypto_device_id IS NULL
            OR approved_by_crypto_device_id <> pending_crypto_device_id
        );
