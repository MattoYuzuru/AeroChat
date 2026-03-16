CREATE TABLE user_friend_requests (
    requester_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    addressee_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    user_low_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    user_high_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_low_id, user_high_id),
    CONSTRAINT user_friend_requests_not_self CHECK (requester_user_id <> addressee_user_id),
    CONSTRAINT user_friend_requests_pair_distinct CHECK (user_low_id <> user_high_id),
    CONSTRAINT user_friend_requests_pair_members CHECK (
        (requester_user_id = user_low_id AND addressee_user_id = user_high_id)
        OR (requester_user_id = user_high_id AND addressee_user_id = user_low_id)
    )
);

CREATE INDEX idx_user_friend_requests_requester_user_id ON user_friend_requests (requester_user_id, created_at DESC);
CREATE INDEX idx_user_friend_requests_addressee_user_id ON user_friend_requests (addressee_user_id, created_at DESC);

CREATE TABLE user_friendships (
    user_low_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    user_high_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_low_id, user_high_id),
    CONSTRAINT user_friendships_distinct CHECK (user_low_id <> user_high_id)
);

CREATE INDEX idx_user_friendships_user_low_id ON user_friendships (user_low_id, created_at DESC);
CREATE INDEX idx_user_friendships_user_high_id ON user_friendships (user_high_id, created_at DESC);
