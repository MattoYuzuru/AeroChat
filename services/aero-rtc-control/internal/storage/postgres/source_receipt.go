package postgres

import (
	"context"
	"errors"

	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/revocation"
	ql "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/storage/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *MediaStore) GetSourceReceipt(ctx context.Context, domain string, event uuid.UUID) (revocation.Receipt, error) {
	if (domain != "identity" && domain != "chat") || event == uuid.Nil {
		return revocation.Receipt{}, revocation.ErrInvalidArgument
	}
	r, err := s.q.GetMediaSourceReceipt(ctx, ql.GetMediaSourceReceiptParams{OriginDomain: domain, EventID: event})
	if errors.Is(err, pgx.ErrNoRows) {
		return revocation.Receipt{}, revocation.ErrNotFound
	}
	if err != nil {
		return revocation.Receipt{}, mediaError(err)
	}
	return revocation.Receipt{Domain: r.OriginDomain, EventID: r.EventID, OperationID: r.OperationID, AffectedRegistryGrants: r.AffectedRegistryGrants}, nil
}
