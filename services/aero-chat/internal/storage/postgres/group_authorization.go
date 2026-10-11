package postgres

import (
	"context"

	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	chatsqlc "github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/storage/sqlc"
)

func (r *Repository) GetGroupSubjectAuthorityFacts(ctx context.Context, groupID, userID string) (chat.GroupSubjectAuthorityFacts, error) {
	row, err := r.queries.GetGroupSubjectAuthorityFacts(ctx, chatsqlc.GetGroupSubjectAuthorityFactsParams{GroupID: mustParseUUID(groupID), UserID: mustParseUUID(userID)})
	if err != nil {
		return chat.GroupSubjectAuthorityFacts{}, err
	}
	return chat.GroupSubjectAuthorityFacts{GroupID: row.GroupID.String(), UserID: row.UserID.String(), GroupExists: row.GroupExists, MembershipExists: row.MembershipExists, AuthorityExists: row.AuthorityExists, EligibilityEpoch: row.EligibilityEpoch, Present: row.Present, Eligible: row.Eligible, Role: row.Role}, nil
}
