-- name: GetCryptoDeviceRegistryStatsByUserID :one
SELECT
    COUNT(*)::bigint AS total_count,
    COUNT(*) FILTER (WHERE status = 'active')::bigint AS active_count,
    COUNT(*) FILTER (WHERE status = 'pending_link')::bigint AS pending_count
FROM crypto_devices
WHERE user_id = $1;

-- name: CreateCryptoDevice :one
INSERT INTO crypto_devices (
    id,
    user_id,
    label,
    status,
    linked_by_crypto_device_id,
    last_bundle_version,
    last_bundle_published_at,
    created_at,
    activated_at,
    revoked_at,
    revocation_reason,
    revoked_by_actor
) VALUES (
    $1,
    $2,
    $3,
    $4,
    $5,
    $6,
    $7,
    $8,
    $9,
    $10,
    $11,
    $12
)
RETURNING
    id,
    user_id,
    label,
    status,
    linked_by_crypto_device_id,
    last_bundle_version,
    last_bundle_published_at,
    created_at,
    activated_at,
    revoked_at,
    revocation_reason,
    revoked_by_actor;

-- name: ListCryptoDevicesByUserID :many
SELECT
    id,
    user_id,
    label,
    status,
    linked_by_crypto_device_id,
    last_bundle_version,
    last_bundle_published_at,
    created_at,
    activated_at,
    revoked_at,
    revocation_reason,
    revoked_by_actor
FROM crypto_devices
WHERE user_id = $1
ORDER BY created_at DESC;

-- name: GetCryptoDeviceByIDAndUserID :one
SELECT
    id,
    user_id,
    label,
    status,
    linked_by_crypto_device_id,
    last_bundle_version,
    last_bundle_published_at,
    created_at,
    activated_at,
    revoked_at,
    revocation_reason,
    revoked_by_actor
FROM crypto_devices
WHERE id = $1 AND user_id = $2;

-- name: UpdateCryptoDeviceBundleTracking :one
UPDATE crypto_devices
SET
    last_bundle_version = $3,
    last_bundle_published_at = $4
WHERE id = $1 AND user_id = $2
RETURNING
    id,
    user_id,
    label,
    status,
    linked_by_crypto_device_id,
    last_bundle_version,
    last_bundle_published_at,
    created_at,
    activated_at,
    revoked_at,
    revocation_reason,
    revoked_by_actor;

-- name: ActivateCryptoDevice :one
UPDATE crypto_devices
SET
    status = 'active',
    activated_at = $3,
    linked_by_crypto_device_id = $4
WHERE id = $1 AND user_id = $2 AND status = 'pending_link' AND revoked_at IS NULL
RETURNING
    id,
    user_id,
    label,
    status,
    linked_by_crypto_device_id,
    last_bundle_version,
    last_bundle_published_at,
    created_at,
    activated_at,
    revoked_at,
    revocation_reason,
    revoked_by_actor;

-- name: RevokeCryptoDeviceWithMetadata :one
UPDATE crypto_devices
SET
    status = 'revoked',
    revoked_at = $3,
    revocation_reason = $4,
    revoked_by_actor = $5
WHERE id = $1 AND user_id = $2 AND status <> 'revoked'
RETURNING
    id,
    user_id,
    label,
    status,
    linked_by_crypto_device_id,
    last_bundle_version,
    last_bundle_published_at,
    created_at,
    activated_at,
    revoked_at,
    revocation_reason,
    revoked_by_actor;

-- name: CreateCryptoDeviceBundle :one
INSERT INTO crypto_device_bundles (
    crypto_device_id,
    bundle_version,
    crypto_suite,
    identity_public_key,
    signed_prekey_public,
    signed_prekey_id,
    signed_prekey_signature,
    kem_public_key,
    kem_key_id,
    kem_signature,
    one_time_prekeys_total,
    one_time_prekeys_available,
    bundle_digest,
    published_at,
    expires_at,
    superseded_at
) VALUES (
    $1,
    $2,
    $3,
    $4,
    $5,
    $6,
    $7,
    $8,
    $9,
    $10,
    $11,
    $12,
    $13,
    $14,
    $15,
    $16
)
RETURNING
    crypto_device_id,
    bundle_version,
    crypto_suite,
    identity_public_key,
    signed_prekey_public,
    signed_prekey_id,
    signed_prekey_signature,
    kem_public_key,
    kem_key_id,
    kem_signature,
    one_time_prekeys_total,
    one_time_prekeys_available,
    bundle_digest,
    published_at,
    expires_at,
    superseded_at;

-- name: SupersedeCurrentCryptoDeviceBundle :execrows
UPDATE crypto_device_bundles
SET superseded_at = $2
WHERE crypto_device_id = $1 AND superseded_at IS NULL;

-- name: GetCurrentCryptoDeviceBundleByDeviceID :one
SELECT
    crypto_device_id,
    bundle_version,
    crypto_suite,
    identity_public_key,
    signed_prekey_public,
    signed_prekey_id,
    signed_prekey_signature,
    kem_public_key,
    kem_key_id,
    kem_signature,
    one_time_prekeys_total,
    one_time_prekeys_available,
    bundle_digest,
    published_at,
    expires_at,
    superseded_at
FROM crypto_device_bundles
WHERE crypto_device_id = $1 AND superseded_at IS NULL;

-- name: GetCurrentCryptoDeviceBundleByDeviceIDAndUserID :one
SELECT
    b.crypto_device_id,
    b.bundle_version,
    b.crypto_suite,
    b.identity_public_key,
    b.signed_prekey_public,
    b.signed_prekey_id,
    b.signed_prekey_signature,
    b.kem_public_key,
    b.kem_key_id,
    b.kem_signature,
    b.one_time_prekeys_total,
    b.one_time_prekeys_available,
    b.bundle_digest,
    b.published_at,
    b.expires_at,
    b.superseded_at
FROM crypto_device_bundles AS b
JOIN crypto_devices AS d ON d.id = b.crypto_device_id
WHERE b.crypto_device_id = $1 AND d.user_id = $2 AND b.superseded_at IS NULL;

-- name: ExpireStaleCryptoDeviceLinkIntentsByUserID :execrows
UPDATE crypto_device_link_intents
SET
    status = 'expired',
    expired_at = $2
WHERE user_id = $1 AND status = 'pending' AND expires_at <= $2;

-- name: CreateCryptoDeviceLinkIntent :one
INSERT INTO crypto_device_link_intents (
    id,
    user_id,
    pending_crypto_device_id,
    status,
    bundle_digest,
    created_at,
    expires_at,
    approved_at,
    expired_at,
    approved_by_crypto_device_id
) VALUES (
    $1,
    $2,
    $3,
    $4,
    $5,
    $6,
    $7,
    $8,
    $9,
    $10
)
RETURNING
    id,
    user_id,
    pending_crypto_device_id,
    status,
    bundle_digest,
    created_at,
    expires_at,
    approved_at,
    expired_at,
    approved_by_crypto_device_id;

-- name: GetCryptoDeviceLinkIntentByIDAndUserID :one
SELECT
    id,
    user_id,
    pending_crypto_device_id,
    status,
    bundle_digest,
    created_at,
    expires_at,
    approved_at,
    expired_at,
    approved_by_crypto_device_id
FROM crypto_device_link_intents
WHERE id = $1 AND user_id = $2;

-- name: GetPendingCryptoDeviceLinkIntentByDeviceID :one
SELECT
    id,
    user_id,
    pending_crypto_device_id,
    status,
    bundle_digest,
    created_at,
    expires_at,
    approved_at,
    expired_at,
    approved_by_crypto_device_id
FROM crypto_device_link_intents
WHERE pending_crypto_device_id = $1 AND status = 'pending';

-- name: ListCryptoDeviceLinkIntentsByUserID :many
SELECT
    id,
    user_id,
    pending_crypto_device_id,
    status,
    bundle_digest,
    created_at,
    expires_at,
    approved_at,
    expired_at,
    approved_by_crypto_device_id
FROM crypto_device_link_intents
WHERE user_id = $1
ORDER BY created_at DESC;

-- name: ApproveCryptoDeviceLinkIntentByIDAndUserID :one
UPDATE crypto_device_link_intents
SET
    status = 'approved',
    approved_at = $3,
    approved_by_crypto_device_id = $4
WHERE id = $1 AND user_id = $2 AND status = 'pending'
RETURNING
    id,
    user_id,
    pending_crypto_device_id,
    status,
    bundle_digest,
    created_at,
    expires_at,
    approved_at,
    expired_at,
    approved_by_crypto_device_id;

-- name: ExpireCryptoDeviceLinkIntentByIDAndUserID :one
UPDATE crypto_device_link_intents
SET
    status = 'expired',
    expired_at = $3
WHERE id = $1 AND user_id = $2 AND status = 'pending'
RETURNING
    id,
    user_id,
    pending_crypto_device_id,
    status,
    bundle_digest,
    created_at,
    expires_at,
    approved_at,
    expired_at,
    approved_by_crypto_device_id;

-- name: ExpirePendingCryptoDeviceLinkIntentsByDeviceID :execrows
UPDATE crypto_device_link_intents
SET
    status = 'expired',
    expired_at = $2
WHERE pending_crypto_device_id = $1 AND status = 'pending';
