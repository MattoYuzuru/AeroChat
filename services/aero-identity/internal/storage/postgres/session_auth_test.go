package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/domain/identity"
)

func TestGetSessionAuthByIDRejectsMalformedID(t *testing.T) {
	for _, id := range []string{"", "not-a-uuid"} {
		t.Run(id, func(t *testing.T) {
			defer func() {
				if recover() != nil {
					t.Fatal("malformed id must return error before database access")
				}
			}()
			if _, err := NewRepository(nil).GetSessionAuthByID(context.Background(), id); !errors.Is(err, identity.ErrUnauthorized) {
				t.Fatalf("expected unauthorized: %v", err)
			}
		})
	}
}
