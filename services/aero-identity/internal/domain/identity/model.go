package identity

import "time"

const (
	KeyBackupStatusNotConfigured = "not_configured"
	KeyBackupStatusConfigured    = "configured"
)

type User struct {
	ID                      string
	Login                   string
	Nickname                string
	AvatarURL               *string
	Bio                     *string
	Timezone                *string
	ProfileAccent           *string
	StatusText              *string
	Birthday                *time.Time
	Country                 *string
	City                    *string
	ReadReceiptsEnabled     bool
	PresenceEnabled         bool
	TypingVisibilityEnabled bool
	KeyBackupStatus         string
	CreatedAt               time.Time
	UpdatedAt               time.Time
}

type Device struct {
	ID         string
	UserID     string
	Label      string
	CreatedAt  time.Time
	LastSeenAt time.Time
	RevokedAt  *time.Time
}

type Session struct {
	ID         string
	UserID     string
	DeviceID   string
	CreatedAt  time.Time
	LastSeenAt time.Time
	RevokedAt  *time.Time
}

type DeviceWithSessions struct {
	Device   Device
	Sessions []Session
}

type BlockedUser struct {
	Profile   User
	BlockedAt time.Time
}

type AuthSession struct {
	User    User
	Device  Device
	Session Session
	Token   string
}

type RegisterInput struct {
	Login       string
	Password    string
	Nickname    string
	DeviceLabel *string
}

type LoginInput struct {
	Login       string
	Password    string
	DeviceLabel *string
}

type ProfilePatch struct {
	Nickname                *string
	AvatarURL               *string
	Bio                     *string
	Timezone                *string
	ProfileAccent           *string
	StatusText              *string
	Birthday                *string
	Country                 *string
	City                    *string
	ReadReceiptsEnabled     *bool
	PresenceEnabled         *bool
	TypingVisibilityEnabled *bool
}

type SessionTarget struct {
	SessionID *string
	DeviceID  *string
}

type PasswordCredential struct {
	User         User
	PasswordHash string
}

type SessionAuth struct {
	User      User
	Device    Device
	Session   Session
	TokenHash string
}

type CreateAccountParams struct {
	User         User
	PasswordHash string
	Device       Device
	Session      Session
	TokenHash    string
}

type CreateSessionParams struct {
	UserID    string
	Device    Device
	Session   Session
	TokenHash string
}
