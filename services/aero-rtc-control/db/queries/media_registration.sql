-- name: LockAdmissionFence :one
SELECT last_fence FROM rtc_admission_fence WHERE singleton=TRUE FOR UPDATE;

-- name: GetAdmissionInstanceByLeaf :one
SELECT * FROM rtc_admission_instances WHERE leaf_fingerprint=$1;

-- name: AdvanceAdmissionFence :one
UPDATE rtc_admission_fence SET last_fence=last_fence+1
WHERE singleton=TRUE AND last_fence<9223372036854775807
RETURNING last_fence;

-- name: CreateAdmissionInstance :one
INSERT INTO rtc_admission_instances(leaf_fingerprint,instance_id,request_id,registration_fence,state)
VALUES($1,$2,$3,$4,'active') RETURNING *;
