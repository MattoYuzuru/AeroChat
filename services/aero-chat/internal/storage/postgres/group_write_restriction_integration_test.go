//go:build integration

package postgres

import (
	"testing"
	"time"

	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestGroupAuthorityWriteRestrictionTimestampRoundTrip(t *testing.T) {
	db, ctx := groupAuthorityDatabase(t, false)
	group, user := groupAuthorityPair(t, ctx, db, "member")
	repo := NewRepository(db)
	first := time.Now().UTC().Truncate(time.Microsecond)
	second := first.Add(time.Minute)
	for _, tc := range []struct {
		name       string
		restricted bool
		at         *time.Time
		changed    bool
		stored     *time.Time
	}{
		{"restrict", true, &first, true, &first},
		{"same_timestamp_replay", true, &first, false, &first},
		{"replace_timestamp", true, &second, true, &second},
		{"unrestrict", false, &second, true, nil},
		{"unrestricted_replay", false, nil, false, nil},
		{"restrict_without_timestamp", true, nil, true, nil},
		{"clear_without_timestamp", false, nil, true, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			changed, err := repo.SetGroupMemberWriteRestriction(ctx, chat.SetGroupMemberWriteRestrictionParams{
				GroupID: group, UserID: user, IsWriteRestricted: tc.restricted,
				WriteRestrictedAt: tc.at, UpdatedAt: time.Now().UTC(),
			})
			if err != nil || changed != tc.changed {
				t.Fatalf("changed=%t want=%t err=%v", changed, tc.changed, err)
			}
			var restricted bool
			var at pgtype.Timestamptz
			if err := db.QueryRow(ctx, "SELECT is_write_restricted,write_restricted_at FROM group_memberships WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user)).Scan(&restricted, &at); err != nil {
				t.Fatal(err)
			}
			if restricted != tc.restricted || at.Valid != (tc.stored != nil) || tc.stored != nil && !at.Time.Equal(*tc.stored) {
				t.Fatal("restriction timestamp did not round-trip")
			}
			assertGroupAuthority(t, ctx, db, group, user, 1, true, true, 0)
		})
	}
}
