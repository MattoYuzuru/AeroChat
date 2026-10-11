-- name: GetGroupSubjectAuthorityFacts :one
WITH subject AS (
    SELECT sqlc.arg(group_id)::UUID AS group_id, sqlc.arg(user_id)::UUID AS user_id
)
SELECT
    s.group_id,
    s.user_id,
    (g.id IS NOT NULL)::BOOLEAN AS group_exists,
    (m.user_id IS NOT NULL)::BOOLEAN AS membership_exists,
    (a.user_id IS NOT NULL)::BOOLEAN AS authority_exists,
    COALESCE(a.revision, 0)::BIGINT AS eligibility_epoch,
    COALESCE(a.present, FALSE)::BOOLEAN AS present,
    COALESCE(a.eligible, FALSE)::BOOLEAN AS eligible,
    COALESCE(m.role, '')::TEXT AS role
FROM subject AS s
LEFT JOIN groups AS g ON g.id = s.group_id
LEFT JOIN group_memberships AS m ON m.group_id = s.group_id AND m.user_id = s.user_id
LEFT JOIN group_membership_authority_versions AS a ON a.group_id = s.group_id AND a.user_id = s.user_id;
