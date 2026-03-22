package chatsqlc

import (
	"strings"
	"testing"
)

func TestGroupRowQueriesKeepViewerRestrictionOutOfTopLevelAggregate(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		query string
	}{
		{
			name:  "list groups",
			query: listGroupRowsByUserID,
		},
		{
			name:  "get group",
			query: getGroupRowByIDAndUserID,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			normalized := strings.Join(strings.Fields(tc.query), " ")

			if !strings.Contains(normalized, "self.is_write_restricted AS self_is_write_restricted") {
				t.Fatalf("запрос должен возвращать viewer-relative write restriction: %s", normalized)
			}
			if !strings.Contains(normalized, "SELECT COUNT(*)::INT FROM group_memberships AS members WHERE members.group_id = g.id") {
				t.Fatalf("ожидался отдельный deterministic member_count subquery: %s", normalized)
			}
			if strings.Contains(normalized, "COUNT(m.user_id)::INT AS member_count") {
				t.Fatalf("top-level member_count aggregate не должен возвращаться: %s", normalized)
			}
			if strings.Contains(normalized, "JOIN group_memberships AS m ON m.group_id = g.id") {
				t.Fatalf("join для top-level member_count не должен возвращаться: %s", normalized)
			}
			if strings.Contains(normalized, " GROUP BY ") {
				t.Fatalf("group row query больше не должен зависеть от top-level GROUP BY: %s", normalized)
			}
		})
	}
}
