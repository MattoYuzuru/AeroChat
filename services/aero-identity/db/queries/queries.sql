-- Foundation phase: sqlc подключён заранее, но доменные запросы появятся только на этапе Identity foundation.

-- name: FoundationStatus :one
SELECT 'foundation'::text AS stage;
