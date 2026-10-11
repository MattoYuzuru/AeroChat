//go:build integration

package postgres

import (
	"context"
	"crypto/sha256"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	chatsqlc "github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/storage/sqlc"
)

func (f *encryptedClockFixture) immutableMetadataSnapshot(t *testing.T) [32]byte {
	t.Helper()
	_, messages, key := f.sequenceTable()
	var metadata, deliveries, links string
	if err := f.db.QueryRow(f.ctx, "SELECT COALESCE(jsonb_agg(to_jsonb(m)-'server_sequence' ORDER BY id),'[]'::jsonb)::text FROM "+messages+" m WHERE "+key+"=$1", mustParseUUID(f.conversationID)).Scan(&metadata); err != nil {
		t.Fatal(err)
	}
	deliveryTable := "direct_chat_encrypted_message_deliveries_v2"
	if f.kind == "group" {
		deliveryTable = "group_encrypted_message_deliveries_v1"
	}
	if err := f.db.QueryRow(f.ctx, "SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.message_id,d.recipient_crypto_device_id),'[]'::jsonb)::text FROM "+deliveryTable+" d JOIN "+messages+" m ON m.id=d.message_id WHERE m."+key+"=$1", mustParseUUID(f.conversationID)).Scan(&deliveries); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRow(f.ctx, "SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY attachment_id),'[]'::jsonb)::text FROM message_attachments a").Scan(&links); err != nil {
		t.Fatal(err)
	}
	return sha256.Sum256([]byte(metadata + deliveries + links))
}

func (f *encryptedClockFixture) sequenceTable() (string, string, string) {
	if f.kind == "direct" {
		return "direct_chats", "direct_chat_encrypted_messages_v2", "chat_id"
	}
	return "groups", "group_encrypted_messages_v1", "group_id"
}

func (f *encryptedClockFixture) store(ctx context.Context, id string, createdAt time.Time) (int64, error) {
	if f.kind == "direct" {
		stored, err := f.repo.CreateEncryptedDirectMessageV2(ctx, chat.CreateEncryptedDirectMessageV2Params{
			MessageID: id, ChatID: f.conversationID, SenderUserID: f.owner, SenderCryptoDeviceID: f.ownerDevice,
			OperationKind: chat.EncryptedDirectMessageV2OperationContent, Revision: 1, CreatedAt: createdAt, StoredAt: time.Now().UTC(),
			Deliveries: []chat.EncryptedDirectMessageV2Delivery{{RecipientUserID: f.peer, RecipientCryptoDeviceID: f.peerDevice, TransportHeader: []byte("fixture"), Ciphertext: []byte("opaque sequence fixture"), CiphertextSizeBytes: 23}},
		})
		if err != nil {
			return 0, err
		}
		return stored.ServerSequence, nil
	}
	stored, err := f.repo.CreateEncryptedGroupMessage(ctx, chat.CreateEncryptedGroupMessageParams{
		MessageID: id, GroupID: f.conversationID, ThreadID: f.threadID, MLSGroupID: f.mlsID, RosterVersion: 1,
		SenderUserID: f.owner, SenderCryptoDeviceID: f.ownerDevice, OperationKind: chat.EncryptedGroupMessageOperationContent,
		Revision: 1, Ciphertext: []byte("opaque sequence fixture"), CreatedAt: createdAt, StoredAt: time.Now().UTC(),
		Deliveries: []chat.EncryptedGroupMessageDelivery{{RecipientUserID: f.peer, RecipientCryptoDeviceID: f.peerDevice}},
	})
	if err != nil {
		return 0, err
	}
	return stored.ServerSequence, nil
}

func (f *encryptedClockFixture) holdFirstMessage(t *testing.T) pgx.Tx {
	t.Helper()
	tx, err := f.db.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { rollbackEncryptedMessageTx(tx) })
	q := f.repo.queries.WithTx(tx)
	id, now := uuid.New(), time.Now().UTC()
	if f.kind == "direct" {
		sequence, reserveErr := q.ReserveDirectEncryptedSequence(f.ctx, mustParseUUID(f.conversationID))
		if reserveErr != nil {
			t.Fatal(reserveErr)
		}
		_, err = q.CreateDirectChatEncryptedMessageV2(f.ctx, chatsqlc.CreateDirectChatEncryptedMessageV2Params{
			ID: id, ChatID: mustParseUUID(f.conversationID), SenderUserID: mustParseUUID(f.owner), SenderCryptoDeviceID: mustParseUUID(f.ownerDevice),
			OperationKind: chat.EncryptedDirectMessageV2OperationContent, Revision: 1, CreatedAt: timestamptzValue(now), StoredAt: timestamptzValue(now), ServerSequence: pgtype.Int8{Int64: sequence, Valid: true},
		})
	} else {
		sequence, reserveErr := q.ReserveGroupEncryptedSequence(f.ctx, mustParseUUID(f.conversationID))
		if reserveErr != nil {
			t.Fatal(reserveErr)
		}
		_, err = q.CreateEncryptedGroupMessage(f.ctx, chatsqlc.CreateEncryptedGroupMessageParams{
			ID: id, GroupID: mustParseUUID(f.conversationID), ThreadID: mustParseUUID(f.threadID), MlsGroupID: mustParseUUID(f.mlsID), RosterVersion: 1,
			SenderUserID: mustParseUUID(f.owner), SenderCryptoDeviceID: mustParseUUID(f.ownerDevice), OperationKind: chat.EncryptedGroupMessageOperationContent,
			Revision: 1, Ciphertext: []byte("opaque held fixture"), CiphertextSizeBytes: 19,
			CreatedAt: timestamptzValue(now), StoredAt: timestamptzValue(now), ServerSequence: pgtype.Int8{Int64: sequence, Valid: true},
		})
	}
	if err != nil {
		t.Fatal(err)
	}
	return tx
}

func (f *encryptedClockFixture) waitForSequenceLock(t *testing.T) {
	t.Helper()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting int
		if err := f.db.QueryRow(f.ctx, "SELECT count(*) FROM pg_stat_activity WHERE application_name = current_setting('application_name') AND wait_event_type = 'Lock'").Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting > 0 {
			return
		}
		select {
		case <-f.ctx.Done():
			t.Fatal("writer did not reach real PostgreSQL sequence lock")
		case <-ticker.C:
		}
	}
}

func TestEncryptedSequenceFollowsCommitAndRollback(t *testing.T) {
	for _, kind := range []string{"direct", "group"} {
		for _, commit := range []bool{true, false} {
			name := "rollback"
			if commit {
				name = "commit"
			}
			t.Run(kind+"/"+name, func(t *testing.T) {
				f := newEncryptedClockFixture(t, kind)
				first := f.holdFirstMessage(t)
				type outcome struct {
					sequence int64
					err      error
				}
				result := make(chan outcome, 1)
				go func() {
					sequence, err := f.store(f.ctx, uuid.NewString(), time.Now().Add(-time.Hour))
					result <- outcome{sequence, err}
				}()
				f.waitForSequenceLock(t)
				select {
				case <-result:
					t.Fatal("second writer bypassed commit barrier")
				default:
				}
				_, messages, conversationKey := f.sequenceTable()
				var visible int
				if err := f.db.QueryRow(f.ctx, "SELECT count(*) FROM "+messages+" WHERE "+conversationKey+"=$1", mustParseUUID(f.conversationID)).Scan(&visible); err != nil || visible != 0 {
					t.Fatalf("uncommitted sequence/message became visible: count=%d err=%v", visible, err)
				}
				want := int64(1)
				if commit {
					want = 2
					if err := first.Commit(f.ctx); err != nil {
						t.Fatal(err)
					}
				} else {
					if err := first.Rollback(f.ctx); err != nil {
						t.Fatal(err)
					}
				}
				select {
				case got := <-result:
					if got.err != nil || got.sequence != want {
						t.Fatalf("commit sequence: got=%d want=%d err=%v", got.sequence, want, got.err)
					}
				case <-f.ctx.Done():
					t.Fatal("blocked writer did not resume")
				}
				if err := f.repo.CheckEncryptedSequencesReady(f.ctx); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestEncryptedSequenceUsesServerStorageTimeWithoutRewritingSenderMetadata(t *testing.T) {
	for _, kind := range []string{"direct", "group"} {
		t.Run(kind, func(t *testing.T) {
			f := newEncryptedClockFixture(t, kind)
			future := time.Date(2099, 1, 1, 0, 0, 0, 0, time.UTC)
			before := time.Now().Add(-time.Second)
			id := uuid.NewString()
			sequence, err := f.store(f.ctx, id, future)
			if err != nil || sequence != 1 {
				t.Fatalf("server accepted sequence: %d err=%v", sequence, err)
			}
			var createdAt, storedAt time.Time
			_, messages, _ := f.sequenceTable()
			if err := f.db.QueryRow(f.ctx, "SELECT created_at,stored_at FROM "+messages+" WHERE id=$1", mustParseUUID(id)).Scan(&createdAt, &storedAt); err != nil {
				t.Fatal(err)
			}
			if !createdAt.Equal(future) || storedAt.Before(before) || storedAt.After(time.Now().Add(time.Second)) || !storedAt.Before(createdAt) {
				t.Fatal("stored_at inherited sender clock or changed authenticated created_at")
			}
		})
	}
}

func TestEncryptedSequenceCancelConflictAndOverflowDoNotConsumeCounter(t *testing.T) {
	for _, kind := range []string{"direct", "group"} {
		t.Run(kind, func(t *testing.T) {
			f := newEncryptedClockFixture(t, kind)
			first := f.holdFirstMessage(t)
			ctx, cancel := context.WithCancel(f.ctx)
			result := make(chan error, 1)
			go func() { _, err := f.store(ctx, uuid.NewString(), time.Now()); result <- err }()
			f.waitForSequenceLock(t)
			cancel()
			select {
			case err := <-result:
				if err == nil {
					t.Fatal("cancelled blocked writer succeeded")
				}
			case <-f.ctx.Done():
				t.Fatal("cancelled writer retained transaction")
			}
			if err := first.Rollback(f.ctx); err != nil {
				t.Fatal(err)
			}
			id := uuid.NewString()
			sequence, err := f.store(f.ctx, id, time.Now())
			if err != nil || sequence != 1 {
				t.Fatalf("rollback consumed counter: seq=%d err=%v", sequence, err)
			}
			if _, err := f.store(f.ctx, id, time.Now()); !errors.Is(err, chat.ErrConflict) {
				t.Fatalf("duplicate ID must preserve conflict semantics: %v", err)
			}
			sequence, err = f.store(f.ctx, uuid.NewString(), time.Now())
			if err != nil || sequence != 2 {
				t.Fatalf("failed duplicate consumed counter: seq=%d err=%v", sequence, err)
			}
			conversation, messages, key := f.sequenceTable()
			if _, err := f.db.Exec(f.ctx, "UPDATE "+conversation+" SET encrypted_server_sequence=$2 WHERE id=$1", mustParseUUID(f.conversationID), int64(math.MaxInt64)); err != nil {
				t.Fatal(err)
			}
			if _, err := f.store(f.ctx, uuid.NewString(), time.Now()); err == nil {
				t.Fatal("int64 exhaustion wrapped or accepted a message")
			}
			var count int
			if err := f.db.QueryRow(f.ctx, "SELECT count(*) FROM "+messages+" WHERE "+key+"=$1", mustParseUUID(f.conversationID)).Scan(&count); err != nil || count != 2 {
				t.Fatalf("overflow partially inserted message: count=%d err=%v", count, err)
			}
		})
	}
}

func TestEncryptedSequenceBackfillIsBoundedResumableAndReadSafe(t *testing.T) {
	for _, kind := range []string{"direct", "group"} {
		t.Run(kind, func(t *testing.T) {
			f := newEncryptedClockFixture(t, kind)
			future := f.create(t, time.Date(2099, 1, 1, 0, 0, 0, 0, time.UTC))
			f.markRead(t, future)
			older := f.create(t, time.Now().Add(-time.Hour))
			conversation, messages, key := f.sequenceTable()
			if _, err := f.db.Exec(f.ctx, "UPDATE "+messages+" SET server_sequence=NULL WHERE "+key+"=$1", mustParseUUID(f.conversationID)); err != nil {
				t.Fatal(err)
			}
			if _, err := f.db.Exec(f.ctx, "UPDATE "+conversation+" SET encrypted_server_sequence=0 WHERE id=$1", mustParseUUID(f.conversationID)); err != nil {
				t.Fatal(err)
			}
			if !errors.Is(f.repo.CheckEncryptedSequencesReady(f.ctx), chat.ErrConflict) {
				t.Fatal("legacy metadata did not block listener readiness")
			}
			dry, err := f.repo.BackfillEncryptedSequences(f.ctx, false, 1, 1)
			if err != nil || dry.Migrated != 0 || dry.Candidates != 1 || dry.Ready {
				t.Fatalf("dry run did not preserve bounded legacy state: %+v err=%v", dry, err)
			}
			var assigned int
			if err := f.db.QueryRow(f.ctx, "SELECT count(*) FROM "+messages+" WHERE "+key+"=$1 AND server_sequence IS NOT NULL", mustParseUUID(f.conversationID)).Scan(&assigned); err != nil || assigned != 0 {
				t.Fatal("dry run mutated metadata")
			}
			for batch := 0; batch < 2; batch++ {
				report, err := f.repo.BackfillEncryptedSequences(f.ctx, true, 1, 1)
				if err != nil || report.Migrated != 1 || report.Ready != (batch == 1) {
					t.Fatalf("bounded resumable batch %d: %+v err=%v", batch, report, err)
				}
			}
			var firstSequence, lastSequence int64
			if err := f.db.QueryRow(f.ctx, "SELECT server_sequence FROM "+messages+" WHERE id=$1", mustParseUUID(older)).Scan(&firstSequence); err != nil {
				t.Fatal(err)
			}
			if err := f.db.QueryRow(f.ctx, "SELECT server_sequence FROM "+messages+" WHERE id=$1", mustParseUUID(future)).Scan(&lastSequence); err != nil {
				t.Fatal(err)
			}
			if firstSequence != 1 || lastSequence != 2 {
				t.Fatalf("legacy deterministic ordering: older=%d future=%d", firstSequence, lastSequence)
			}
			if count := f.unread(t); count != 0 {
				t.Fatalf("read repair forgot future target: unread=%d", count)
			}
			report, err := f.repo.BackfillEncryptedSequences(f.ctx, true, 1, 1)
			if err != nil || report.Conversations != 0 || report.Migrated != 0 || !report.Ready {
				t.Fatalf("repeat backfill changed assigned sequences: %+v err=%v", report, err)
			}
			id := f.create(t, time.Now())
			if count := f.unread(t); count != 1 {
				t.Fatalf("backfilled future read suppressed a newly committed message: unread=%d", count)
			}
			f.markRead(t, id)
		})
	}
}

func TestEncryptedSequenceBackfillCancellationPreservesOpaqueMetadata(t *testing.T) {
	for _, kind := range []string{"direct", "group"} {
		t.Run(kind, func(t *testing.T) {
			f := newEncryptedClockFixture(t, kind)
			older := f.create(t, time.Now().Add(-time.Hour))
			future := f.create(t, time.Date(2099, 1, 1, 0, 0, 0, 0, time.UTC))
			f.markRead(t, future)
			preserved := f.create(t, time.Now())
			conversation, messages, _ := f.sequenceTable()
			linkColumn := "encrypted_direct_message_v2_id"
			if kind == "group" {
				linkColumn = "encrypted_group_message_v1_id"
			}
			if _, err := f.db.Exec(f.ctx, "INSERT INTO message_attachments (attachment_id,"+linkColumn+",attached_by_user_id,created_at) VALUES($1,$2,$3,$4)", mustParseUUID(f.attachmentID), mustParseUUID(older), mustParseUUID(f.owner), time.Now()); err != nil {
				t.Fatal(err)
			}
			if _, err := f.db.Exec(f.ctx, "UPDATE "+messages+" SET server_sequence=NULL WHERE id IN ($1,$2)", mustParseUUID(older), mustParseUUID(future)); err != nil {
				t.Fatal(err)
			}
			if _, err := f.db.Exec(f.ctx, "UPDATE "+conversation+" SET encrypted_server_sequence=0 WHERE id=$1", mustParseUUID(f.conversationID)); err != nil {
				t.Fatal(err)
			}
			before := f.immutableMetadataSnapshot(t)
			lock, err := f.db.Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { rollbackEncryptedMessageTx(lock) })
			if _, err := lock.Exec(f.ctx, "SELECT id FROM "+conversation+" WHERE id=$1 FOR UPDATE", mustParseUUID(f.conversationID)); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(f.ctx)
			result := make(chan error, 1)
			go func() { _, err := f.repo.BackfillEncryptedSequences(ctx, true, 1, 1); result <- err }()
			f.waitForSequenceLock(t)
			cancel()
			select {
			case err := <-result:
				if err == nil {
					t.Fatal("cancelled backfill succeeded")
				}
			case <-f.ctx.Done():
				t.Fatal("cancelled backfill retained lock")
			}
			if err := lock.Rollback(f.ctx); err != nil {
				t.Fatal(err)
			}
			var counter int64
			if err := f.db.QueryRow(f.ctx, "SELECT encrypted_server_sequence FROM "+conversation+" WHERE id=$1", mustParseUUID(f.conversationID)).Scan(&counter); err != nil || counter != 0 {
				t.Fatalf("cancelled backfill partly advanced counter: %d err=%v", counter, err)
			}
			for batch := 0; batch < 2; batch++ {
				if _, err := f.repo.BackfillEncryptedSequences(f.ctx, true, 1, 1); err != nil {
					t.Fatal(err)
				}
			}
			if before != f.immutableMetadataSnapshot(t) {
				t.Fatal("backfill rewrote ciphertext, AAD metadata, IDs, deliveries or attachment links")
			}
			var preservedSequence int64
			if err := f.db.QueryRow(f.ctx, "SELECT server_sequence FROM "+messages+" WHERE id=$1", mustParseUUID(preserved)).Scan(&preservedSequence); err != nil || preservedSequence != 3 {
				t.Fatalf("backfill rewrote assigned sequence: %d err=%v", preservedSequence, err)
			}
			if err := f.repo.CheckEncryptedSequencesReady(f.ctx); err != nil {
				t.Fatal(err)
			}
			f.create(t, time.Now())
			if count := f.unread(t); count != 1 {
				t.Fatalf("repaired read target did not allow next unread: %d", count)
			}
		})
	}
}

func TestEncryptedSequenceBackfillResetsNonContentReadTarget(t *testing.T) {
	for _, kind := range []string{"direct", "group"} {
		t.Run(kind, func(t *testing.T) {
			f := newEncryptedClockFixture(t, kind)
			content := f.create(t, time.Now())
			mutation := f.create(t, time.Now())
			_, messages, key := f.sequenceTable()
			if _, err := f.db.Exec(f.ctx, "UPDATE "+messages+" SET operation_kind='edit',target_message_id=$2 WHERE id=$1", mustParseUUID(mutation), mustParseUUID(content)); err != nil {
				t.Fatal(err)
			}
			readTable := "direct_chat_encrypted_read_states_v1"
			if kind == "group" {
				readTable = "group_encrypted_read_states_v1"
			}
			if _, err := f.db.Exec(f.ctx, "INSERT INTO "+readTable+" ("+key+",user_id,last_read_message_id,last_read_message_created_at,updated_at,last_read_server_sequence) VALUES($1,$2,$3,$4,$4,2)", mustParseUUID(f.conversationID), mustParseUUID(f.peer), mustParseUUID(mutation), time.Now()); err != nil {
				t.Fatal(err)
			}
			if !errors.Is(f.repo.CheckEncryptedSequencesReady(f.ctx), chat.ErrConflict) {
				t.Fatal("invalid read target accepted at startup")
			}
			report, err := f.repo.BackfillEncryptedSequences(f.ctx, true, 1, 1)
			if err != nil || !report.Ready || report.Migrated != 0 {
				t.Fatalf("invalid read repair: %+v err=%v", report, err)
			}
			if kind == "direct" {
				entries, err := f.repo.ListEncryptedDirectChatReadStateEntries(f.ctx, f.peer, f.conversationID)
				if err != nil {
					t.Fatal(err)
				}
				for _, entry := range entries {
					if entry.UserID == f.peer && entry.LastReadPosition != nil {
						t.Fatal("invalid read position must be null, not a zero-valued proto object")
					}
				}
			} else {
				entry, err := f.repo.GetEncryptedGroupReadStateEntry(f.ctx, f.peer, f.conversationID)
				if err != nil || entry.LastReadPosition != nil {
					t.Fatalf("invalid group read position must be null: err=%v", err)
				}
			}
			if count := f.unread(t); count != 1 {
				t.Fatalf("reset watermark did not restore content unread: %d", count)
			}
		})
	}
}
