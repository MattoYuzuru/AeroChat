package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	chatsqlc "github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/storage/sqlc"
)

func rollbackEncryptedMessageTx(tx pgx.Tx) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = tx.Rollback(ctx)
}

func encryptedSequenceUnavailable() error {
	return fmt.Errorf("%w: encrypted server sequence backfill is required before serving", chat.ErrConflict)
}

func (r *Repository) CheckEncryptedSequencesReady(ctx context.Context) error {
	ready, err := r.queries.EncryptedSequencesReady(ctx)
	if err != nil {
		return fmt.Errorf("check encrypted sequence metadata: %w", err)
	}
	if !ready {
		return encryptedSequenceUnavailable()
	}
	return nil
}

type EncryptedSequenceBackfillReport struct {
	Conversations int
	Candidates    int
	Migrated      int
	Ready         bool
}

// BackfillEncryptedSequences ограничен одной batch на conversation; writers останавливает оператор.
func (r *Repository) BackfillEncryptedSequences(ctx context.Context, execute bool, batchSize, conversationLimit int32) (*EncryptedSequenceBackfillReport, error) {
	if batchSize < 1 || batchSize > 1000 || conversationLimit < 1 || conversationLimit > 100 {
		return nil, chat.ErrInvalidArgument
	}
	conversations, err := r.queries.ListEncryptedSequenceBackfillConversations(ctx, conversationLimit)
	if err != nil {
		return nil, err
	}
	report := &EncryptedSequenceBackfillReport{}
	for _, conversation := range conversations {
		count, err := r.backfillEncryptedConversation(ctx, conversation.Kind, conversation.ID, batchSize, execute)
		if err != nil {
			return report, err
		}
		report.Conversations++
		report.Candidates += count
		if execute {
			report.Migrated += count
		}
	}
	report.Ready, err = r.queries.EncryptedSequencesReady(ctx)
	return report, err
}

func (r *Repository) backfillEncryptedConversation(parent context.Context, kind string, id uuid.UUID, batchSize int32, execute bool) (int, error) {
	ctx, cancel := context.WithTimeout(parent, 20*time.Second)
	defer cancel()
	q := r.queries
	var tx pgx.Tx
	if execute {
		var err error
		tx, err = r.db.BeginTx(ctx, pgx.TxOptions{})
		if err != nil {
			return 0, err
		}
		defer rollbackEncryptedMessageTx(tx)
		q = q.WithTx(tx)
		switch kind {
		case "direct":
			_, err = q.LockDirectEncryptedConversation(ctx, id)
		case "group":
			_, err = q.LockGroupEncryptedConversation(ctx, id)
		default:
			return 0, chat.ErrInvalidArgument
		}
		if err != nil {
			return 0, err
		}
	}
	var rows []uuid.UUID
	var err error
	switch kind {
	case "direct":
		rows, err = q.ListDirectEncryptedSequenceBackfillRows(ctx, chatsqlc.ListDirectEncryptedSequenceBackfillRowsParams{ChatID: id, Limit: batchSize})
	case "group":
		rows, err = q.ListGroupEncryptedSequenceBackfillRows(ctx, chatsqlc.ListGroupEncryptedSequenceBackfillRowsParams{GroupID: id, Limit: batchSize})
	default:
		return 0, chat.ErrInvalidArgument
	}
	if err != nil || !execute {
		return len(rows), err
	}
	var lastSequence int64
	if kind == "direct" {
		lastSequence, err = q.SetDirectEncryptedSequenceCounter(ctx, chatsqlc.SetDirectEncryptedSequenceCounterParams{ConversationID: id, BatchSize: int64(len(rows))})
	} else {
		lastSequence, err = q.SetGroupEncryptedSequenceCounter(ctx, chatsqlc.SetGroupEncryptedSequenceCounterParams{ConversationID: id, BatchSize: int64(len(rows))})
	}
	if err != nil {
		return 0, err
	}
	for i, messageID := range rows {
		sequence := pgtype.Int8{Int64: lastSequence - int64(len(rows)) + int64(i) + 1, Valid: true}
		var affected int64
		if kind == "direct" {
			affected, err = q.BackfillDirectEncryptedSequence(ctx, chatsqlc.BackfillDirectEncryptedSequenceParams{ChatID: id, ID: messageID, ServerSequence: sequence})
		} else {
			affected, err = q.BackfillGroupEncryptedSequence(ctx, chatsqlc.BackfillGroupEncryptedSequenceParams{GroupID: id, ID: messageID, ServerSequence: sequence})
		}
		if err != nil {
			return 0, err
		}
		if affected != 1 {
			return 0, chat.ErrConflict
		}
	}
	// Read target repair происходит лишь после всех legacy rows в этой conversation.
	if kind == "direct" {
		remaining, readErr := q.ListDirectEncryptedSequenceBackfillRows(ctx, chatsqlc.ListDirectEncryptedSequenceBackfillRowsParams{ChatID: id, Limit: 1})
		if readErr != nil {
			return 0, readErr
		}
		if len(remaining) == 0 {
			if err := q.RepairDirectEncryptedReadSequence(ctx, id); err != nil {
				return 0, err
			}
			if err := q.ResetInvalidDirectEncryptedReadSequence(ctx, id); err != nil {
				return 0, err
			}
		}
	} else {
		remaining, readErr := q.ListGroupEncryptedSequenceBackfillRows(ctx, chatsqlc.ListGroupEncryptedSequenceBackfillRowsParams{GroupID: id, Limit: 1})
		if readErr != nil {
			return 0, readErr
		}
		if len(remaining) == 0 {
			if err := q.RepairGroupEncryptedReadSequence(ctx, id); err != nil {
				return 0, err
			}
			if err := q.ResetInvalidGroupEncryptedReadSequence(ctx, id); err != nil {
				return 0, err
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(rows), nil
}
