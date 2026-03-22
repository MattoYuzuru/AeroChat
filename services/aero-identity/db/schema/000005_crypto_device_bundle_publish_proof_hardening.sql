CREATE TABLE crypto_device_bundle_publish_challenges (
    crypto_device_id UUID PRIMARY KEY REFERENCES crypto_devices (id) ON DELETE CASCADE,
    current_bundle_version BIGINT NOT NULL,
    current_bundle_digest BYTEA NOT NULL,
    publish_challenge BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT crypto_device_bundle_publish_challenges_current_bundle_version_positive CHECK (
        current_bundle_version > 0
    ),
    CONSTRAINT crypto_device_bundle_publish_challenges_current_bundle_digest_nonempty CHECK (
        octet_length(current_bundle_digest) > 0
    ),
    CONSTRAINT crypto_device_bundle_publish_challenges_publish_challenge_nonempty CHECK (
        octet_length(publish_challenge) > 0
    ),
    CONSTRAINT crypto_device_bundle_publish_challenges_expiry_window CHECK (
        expires_at > created_at
    )
);
