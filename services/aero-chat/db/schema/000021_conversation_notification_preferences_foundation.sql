CREATE TABLE direct_chat_notification_preferences (
    chat_id UUID NOT NULL REFERENCES direct_chats(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notifications_enabled BOOLEAN NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX idx_direct_chat_notification_preferences_user_id
    ON direct_chat_notification_preferences(user_id);

CREATE TABLE group_notification_preferences (
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notifications_enabled BOOLEAN NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_group_notification_preferences_user_id
    ON group_notification_preferences(user_id);
