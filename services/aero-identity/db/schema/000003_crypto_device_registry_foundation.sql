CREATE TABLE crypto_devices (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    status TEXT NOT NULL,
    linked_by_crypto_device_id UUID NULL REFERENCES crypto_devices (id) ON DELETE SET NULL,
    last_bundle_version BIGINT NULL,
    last_bundle_published_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL,
    activated_at TIMESTAMPTZ NULL,
    revoked_at TIMESTAMPTZ NULL,
    revocation_reason TEXT NULL,
    revoked_by_actor TEXT NULL,
    CONSTRAINT crypto_devices_label_length CHECK (char_length(label) BETWEEN 1 AND 120),
    CONSTRAINT crypto_devices_status CHECK (status IN ('pending_link', 'active', 'revoked')),
    CONSTRAINT crypto_devices_revoked_by_actor CHECK (
        revoked_by_actor IS NULL OR revoked_by_actor IN ('self', 'linked_device', 'recovery', 'account_reset')
    ),
    CONSTRAINT crypto_devices_revocation_reason_length CHECK (
        revocation_reason IS NULL OR char_length(revocation_reason) <= 500
    ),
    CONSTRAINT crypto_devices_state_shape CHECK (
        (status = 'pending_link' AND activated_at IS NULL AND revoked_at IS NULL)
        OR (status = 'active' AND activated_at IS NOT NULL AND revoked_at IS NULL)
        OR (status = 'revoked' AND revoked_at IS NOT NULL)
    ),
    CONSTRAINT crypto_devices_bundle_tracking CHECK (
        (last_bundle_version IS NULL AND last_bundle_published_at IS NULL)
        OR (last_bundle_version IS NOT NULL AND last_bundle_published_at IS NOT NULL)
    )
);

CREATE INDEX idx_crypto_devices_user_id_created_at
    ON crypto_devices (user_id, created_at DESC);

CREATE INDEX idx_crypto_devices_user_id_status_created_at
    ON crypto_devices (user_id, status, created_at DESC);

CREATE TABLE crypto_device_bundles (
    crypto_device_id UUID NOT NULL REFERENCES crypto_devices (id) ON DELETE CASCADE,
    bundle_version BIGINT NOT NULL,
    crypto_suite TEXT NOT NULL,
    identity_public_key BYTEA NOT NULL,
    signed_prekey_public BYTEA NOT NULL,
    signed_prekey_id TEXT NOT NULL,
    signed_prekey_signature BYTEA NOT NULL,
    kem_public_key BYTEA NULL,
    kem_key_id TEXT NULL,
    kem_signature BYTEA NULL,
    one_time_prekeys_total INTEGER NOT NULL,
    one_time_prekeys_available INTEGER NOT NULL,
    bundle_digest BYTEA NOT NULL,
    published_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NULL,
    superseded_at TIMESTAMPTZ NULL,
    PRIMARY KEY (crypto_device_id, bundle_version),
    CONSTRAINT crypto_device_bundles_crypto_suite_length CHECK (char_length(crypto_suite) BETWEEN 1 AND 64),
    CONSTRAINT crypto_device_bundles_identity_public_key_nonempty CHECK (octet_length(identity_public_key) > 0),
    CONSTRAINT crypto_device_bundles_signed_prekey_public_nonempty CHECK (octet_length(signed_prekey_public) > 0),
    CONSTRAINT crypto_device_bundles_signed_prekey_id_length CHECK (char_length(signed_prekey_id) BETWEEN 1 AND 128),
    CONSTRAINT crypto_device_bundles_signed_prekey_signature_nonempty CHECK (octet_length(signed_prekey_signature) > 0),
    CONSTRAINT crypto_device_bundles_bundle_digest_nonempty CHECK (octet_length(bundle_digest) > 0),
    CONSTRAINT crypto_device_bundles_one_time_prekeys_bounds CHECK (
        one_time_prekeys_total >= 0
        AND one_time_prekeys_available >= 0
        AND one_time_prekeys_available <= one_time_prekeys_total
    ),
    CONSTRAINT crypto_device_bundles_kem_triplet_shape CHECK (
        (kem_public_key IS NULL AND kem_key_id IS NULL AND kem_signature IS NULL)
        OR (kem_public_key IS NOT NULL AND kem_key_id IS NOT NULL AND kem_signature IS NOT NULL)
    ),
    CONSTRAINT crypto_device_bundles_expiry_after_publish CHECK (
        expires_at IS NULL OR expires_at > published_at
    )
);

CREATE UNIQUE INDEX uq_crypto_device_bundles_current_bundle
    ON crypto_device_bundles (crypto_device_id)
    WHERE superseded_at IS NULL;

CREATE INDEX idx_crypto_device_bundles_published_at
    ON crypto_device_bundles (crypto_device_id, published_at DESC);

CREATE TABLE crypto_device_link_intents (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    pending_crypto_device_id UUID NOT NULL REFERENCES crypto_devices (id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    bundle_digest BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    approved_at TIMESTAMPTZ NULL,
    expired_at TIMESTAMPTZ NULL,
    approved_by_crypto_device_id UUID NULL REFERENCES crypto_devices (id) ON DELETE SET NULL,
    CONSTRAINT crypto_device_link_intents_status CHECK (status IN ('pending', 'approved', 'expired')),
    CONSTRAINT crypto_device_link_intents_bundle_digest_nonempty CHECK (octet_length(bundle_digest) > 0),
    CONSTRAINT crypto_device_link_intents_expiry_window CHECK (expires_at > created_at),
    CONSTRAINT crypto_device_link_intents_state_shape CHECK (
        (status = 'pending' AND approved_at IS NULL AND expired_at IS NULL AND approved_by_crypto_device_id IS NULL)
        OR (status = 'approved' AND approved_at IS NOT NULL AND expired_at IS NULL AND approved_by_crypto_device_id IS NOT NULL)
        OR (status = 'expired' AND approved_at IS NULL AND expired_at IS NOT NULL AND approved_by_crypto_device_id IS NULL)
    )
);

CREATE UNIQUE INDEX uq_crypto_device_link_intents_pending_device
    ON crypto_device_link_intents (pending_crypto_device_id)
    WHERE status = 'pending';

CREATE INDEX idx_crypto_device_link_intents_user_id_created_at
    ON crypto_device_link_intents (user_id, created_at DESC);

CREATE INDEX idx_crypto_device_link_intents_pending_device_created_at
    ON crypto_device_link_intents (pending_crypto_device_id, created_at DESC);
