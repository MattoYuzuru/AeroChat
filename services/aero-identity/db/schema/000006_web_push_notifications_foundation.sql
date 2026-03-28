ALTER TABLE users
ADD COLUMN push_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE web_push_subscriptions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh_key TEXT NOT NULL,
    auth_secret TEXT NOT NULL,
    expiration_time TIMESTAMPTZ NULL,
    user_agent TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_web_push_subscriptions_user_id
    ON web_push_subscriptions(user_id);
