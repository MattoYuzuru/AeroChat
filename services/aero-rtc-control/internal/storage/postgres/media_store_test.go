package postgres

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	rtcschema "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/db/schema"
	media "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediastore"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/rtc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func mediaTestDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	db := newTestDatabase(t)
	content, err := rtcschema.Files.ReadFile("000001_dormant_media_grant_store.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(context.Background(), string(content)); err != nil {
		t.Fatal(err)
	}
	return db
}
func mediaTestCall(t *testing.T, db *pgxpool.Pool) (uuid.UUID, uuid.UUID, uuid.UUID) {
	t.Helper()
	user := uuid.New()
	call, group := uuid.New(), uuid.New()
	ctx := context.Background()
	if _, err := db.Exec(ctx, "INSERT INTO users(id) VALUES($1)", user); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	_, _, err := NewRepository(db).CreateCallWithParticipant(ctx, rtc.Call{ID: call.String(), Scope: rtc.ConversationScope{Type: rtc.ScopeTypeGroup, GroupID: group.String()}, CreatedByUserID: user.String(), Status: rtc.CallStatusActive, CreatedAt: now, StartedAt: now, UpdatedAt: now}, rtc.CallParticipant{ID: uuid.NewString(), CallID: call.String(), UserID: user.String(), State: rtc.ParticipantStateActive, JoinedAt: now, UpdatedAt: now})
	if err != nil {
		t.Fatal(err)
	}
	return call, group, user
}
func mediaTestRequest(call, group, user uuid.UUID) media.ReserveRequest {
	return media.ReserveRequest{CallID: call, RequestID: uuid.New(), Authority: media.Authority{GroupID: group, UserID: user, SessionID: uuid.New(), DeviceID: uuid.New(), SessionRevision: 1, DeviceRevision: 1, EligibilityEpoch: 1}, At: time.Now().UTC()}
}
func mustMediaReserve(t *testing.T, s *MediaStore, r media.ReserveRequest) media.Grant {
	t.Helper()
	g, err := s.Reserve(context.Background(), r)
	if err != nil {
		t.Fatal(err)
	}
	return g
}
func mustMediaActivate(t *testing.T, s *MediaStore, g media.Grant) media.Grant {
	t.Helper()
	g, err := s.Activate(context.Background(), g.Key, g.Authority, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	return g
}
func mustMediaRevoke(t *testing.T, s *MediaStore, g media.Grant) media.Operation {
	t.Helper()
	op, err := s.BeginRevoke(context.Background(), media.RevokeRequest{RequestID: uuid.New(), Key: g.Key, Reason: "leave", AuthorityOutcome: "unchanged", At: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	return op
}
func mustMediaClaim(t *testing.T, s *MediaStore, op media.Operation, g media.Grant, action string) media.CleanupClaim {
	t.Helper()
	now := time.Now()
	c, err := s.ClaimCleanup(context.Background(), op.ID, g.Key, action, uuid.New(), now, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	return c
}
func finishMediaSFU(t *testing.T, s *MediaStore, op media.Operation, g media.Grant) {
	t.Helper()
	claim := mustMediaClaim(t, s, op, g, "sfu")
	done, err := s.RecordCleanupAcknowledgement(context.Background(), claim, time.Now())
	if err != nil || done.MediaState != "complete" {
		t.Fatalf("completion=%+v err=%v", done, err)
	}
}

func TestMediaStoreReserveAtomicQuotaBindingAndRollback(t *testing.T) {
	db := mediaTestDatabase(t)
	s := NewMediaStore(db)
	call, group, user := mediaTestCall(t, db)
	ctx := context.Background()
	request := mediaTestRequest(call, group, user)
	g := mustMediaReserve(t, s, request)
	again := mustMediaReserve(t, s, request)
	if again.Key != g.Key || again.ParticipantID != g.ParticipantID {
		t.Fatal("idempotent request changed binding")
	}
	if g.GrantGeneration != 1 || g.RoomGeneration != 1 || g.PrepareDeadline.Sub(g.PreparedAt) != 20*time.Second {
		t.Fatal("invalid initial generation/prepare budget")
	}
	changed := request
	changed.DeviceID = uuid.New()
	if _, err := s.Reserve(ctx, changed); !errors.Is(err, media.ErrConflict) {
		t.Fatal("foreign retry accepted")
	}
	for i := 0; i < 3; i++ {
		u := uuid.New()
		if _, err := db.Exec(ctx, "INSERT INTO users(id) VALUES($1)", u); err != nil {
			t.Fatal(err)
		}
		next := mustMediaReserve(t, s, mediaTestRequest(call, group, u))
		if next.RoomID != g.RoomID || next.RoomName != g.RoomName || next.RoomGeneration != 1 {
			t.Fatal("participant join replaced common room")
		}
	}
	fifth := uuid.New()
	if _, err := db.Exec(ctx, "INSERT INTO users(id) VALUES($1)", fifth); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Reserve(ctx, mediaTestRequest(call, group, fifth)); !errors.Is(err, media.ErrConflict) {
		t.Fatal("fifth participant accepted")
	}
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM rtc_call_participants WHERE user_id=$1", fifth).Scan(&count); err != nil || count != 0 {
		t.Fatal("failed quota retained join")
	}
	// Grant insertion failure must roll back participant + new user generation.
	otherCall, otherGroup, _ := mediaTestCall(t, db)
	faultUser := uuid.New()
	if _, err := db.Exec(ctx, "INSERT INTO users(id) VALUES($1)", faultUser); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `CREATE FUNCTION reject_grant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned grant fault'; END $$; CREATE TRIGGER reject_grant BEFORE INSERT ON rtc_media_grants FOR EACH ROW EXECUTE FUNCTION reject_grant()`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Reserve(ctx, mediaTestRequest(otherCall, otherGroup, faultUser)); err == nil {
		t.Fatal("injected grant fault accepted")
	}
	for _, query := range []string{"SELECT count(*) FROM rtc_call_participants WHERE user_id=$1", "SELECT count(*) FROM rtc_media_user_generations WHERE user_id=$1"} {
		if err := db.QueryRow(ctx, query, faultUser).Scan(&count); err != nil || count != 0 {
			t.Fatal("failed grant retained participant/generation")
		}
	}
}

func TestMediaStorePendingFencedActionsAndLateGeneration(t *testing.T) {
	db := mediaTestDatabase(t)
	s := NewMediaStore(db)
	call, group, user := mediaTestCall(t, db)
	ctx := context.Background()
	// Creator lobby participant keeps call alive across one user's leave/rejoin.
	u := uuid.New()
	if _, err := db.Exec(ctx, "INSERT INTO users(id) VALUES($1)", u); err != nil {
		t.Fatal(err)
	}
	g := mustMediaActivate(t, s, mustMediaReserve(t, s, mediaTestRequest(call, group, u)))
	owner := media.Owner{ID: uuid.New(), Fence: 1}
	lease, err := s.RegisterLease(ctx, g.Key, g.Authority, uuid.New(), owner, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.RegisterLease(ctx, g.Key, g.Authority, uuid.New(), owner, time.Now()); !errors.Is(err, media.ErrConflict) {
		t.Fatal("second live connection accepted")
	}
	op := mustMediaRevoke(t, s, g)
	if op.MediaState != "pending" {
		t.Fatal("revoke prematurely complete")
	}
	if _, err := s.RegisterLease(ctx, g.Key, g.Authority, uuid.New(), owner, time.Now()); !errors.Is(err, media.ErrDenied) {
		t.Fatal("revoking admission open")
	}
	if _, err := s.Reserve(ctx, mediaTestRequest(call, group, u)); !errors.Is(err, media.ErrConflict) {
		t.Fatal("revoking released user slot")
	}
	sfu := mustMediaClaim(t, s, op, g, "sfu")
	partial, err := s.RecordCleanupAcknowledgement(ctx, sfu, time.Now())
	if err != nil || partial.MediaState != "pending" {
		t.Fatal("SFU-only released proxy slot")
	}
	proxy := mustMediaClaim(t, s, op, g, "proxy")
	for _, kind := range []string{"generation", "room", "identity", "operation", "worker", "lease", "owner", "fence"} {
		t.Run(kind, func(t *testing.T) {
			bad := proxy
			switch kind {
			case "generation":
				bad.GrantGeneration++
			case "room":
				bad.RoomName = uuid.New()
			case "identity":
				bad.ParticipantIdentity = uuid.New()
			case "operation":
				bad.OperationID = uuid.New()
			case "worker":
				bad.Worker.ID = uuid.New()
			case "lease":
				bad.LeaseID = uuid.New()
			case "owner":
				bad.AdmissionOwner.ID = uuid.New()
			case "fence":
				bad.AdmissionOwner.Fence++
			}
			if _, err := s.RecordCleanupAcknowledgement(ctx, bad, time.Now()); err == nil {
				t.Fatal("stale ACK accepted")
			}
		})
	}
	done, err := s.RecordCleanupAcknowledgement(ctx, proxy, time.Now())
	if err != nil || done.MediaState != "complete" {
		t.Fatalf("allactions=%+v err=%v", done, err)
	}
	next := mustMediaReserve(t, s, mediaTestRequest(call, group, u))
	if next.GrantGeneration != 2 || next.ParticipantIdentity == g.ParticipantIdentity || next.RoomID == g.RoomID {
		t.Fatal("replacement generation/mapping reused")
	}
	if _, err := s.RecordCleanupAcknowledgement(ctx, proxy, time.Now()); err != nil {
		t.Fatal("matching historical ACK not idempotent")
	}
	current, err := s.Get(ctx, next.GrantID)
	if err != nil || current.State != "prepared" {
		t.Fatal("old ACK released new generation")
	}
	var participantState string
	if err := db.QueryRow(ctx, "SELECT state FROM rtc_call_participants WHERE id=$1", next.ParticipantID).Scan(&participantState); err != nil || participantState != "active" {
		t.Fatal("late ACK changed new participant")
	}
	_ = lease
	_ = user
}

func TestMediaStoreSourceWatermarkInboxAndEligibleRejoin(t *testing.T) {
	db := mediaTestDatabase(t)
	s := NewMediaStore(db)
	call, group, user := mediaTestCall(t, db)
	ctx := context.Background()
	request := mediaTestRequest(call, group, user)
	e := media.SourceEvent{Domain: "chat", Kind: "group", EventID: uuid.New(), SubjectID: group, UserID: user, Revision: 2, At: time.Now()}
	first, err := s.ApplySourceEvent(ctx, e)
	if err != nil || first.MediaState != "complete" {
		t.Fatal("event-before-reserve was not persisted")
	}
	if _, err := s.Reserve(ctx, request); !errors.Is(err, media.ErrDenied) {
		t.Fatal("watermark ignored stale tuple")
	}
	request.EligibilityEpoch = 3
	g := mustMediaActivate(t, s, mustMediaReserve(t, s, request))
	repeated, err := s.ApplySourceEvent(ctx, e)
	if err != nil || repeated.ID != first.ID {
		t.Fatal("source retry was not idempotent")
	}
	changed := e
	changed.Revision = 3
	if _, err := s.ApplySourceEvent(ctx, changed); !errors.Is(err, media.ErrConflict) {
		t.Fatal("changed duplicate payload accepted")
	}
	e.EventID = uuid.New()
	if _, err := s.ApplySourceEvent(ctx, e); err != nil {
		t.Fatal(err)
	}
	current, _ := s.Get(ctx, g.GrantID)
	if current.State != "active" {
		t.Fatal("late deny2 revoked eligible3")
	}
	session := media.SourceEvent{Domain: "identity", Kind: "session", EventID: uuid.New(), SubjectID: g.SessionID, UserID: user, DeviceID: uuid.New(), Revision: 2, At: time.Now()}
	if _, err := s.ApplySourceEvent(ctx, session); err != nil {
		t.Fatal(err)
	}
	current, _ = s.Get(ctx, g.GrantID)
	if current.State != "active" {
		t.Fatal("foreign device event matched")
	}
	session.EventID = uuid.New()
	session.DeviceID = g.DeviceID
	op, err := s.ApplySourceEvent(ctx, session)
	if err != nil || op.MediaState != "pending" || op.AuthorityOutcome != "revoked" {
		t.Fatal("matching session did not stage cleanup")
	}
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM rtc_media_source_inbox WHERE user_id=$1", user).Scan(&count); err != nil || count != 4 {
		t.Fatalf("inbox=%d err=%v", count, err)
	}
	finishMediaSFU(t, s, op, g)
}

func TestMediaStoreLeaseCloseKeepsBudgetAndReplacesSafely(t *testing.T) {
	db := mediaTestDatabase(t)
	s := NewMediaStore(db)
	call, group, user := mediaTestCall(t, db)
	g := mustMediaActivate(t, s, mustMediaReserve(t, s, mediaTestRequest(call, group, user)))
	ctx := context.Background()
	owner := media.Owner{ID: uuid.New(), Fence: 1}
	old, err := s.RegisterLease(ctx, g.Key, g.Authority, uuid.New(), owner, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CloseLease(ctx, old, time.Now()); err != nil {
		t.Fatal(err)
	}
	current, _ := s.Get(ctx, g.GrantID)
	if current.State != "active" {
		t.Fatal("WS close released media grant")
	}
	next, err := s.RegisterLease(ctx, g.Key, g.Authority, uuid.New(), owner, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CloseLease(ctx, old, time.Now()); err != nil {
		t.Fatal(err)
	}
	var state string
	if err := db.QueryRow(ctx, "SELECT state FROM rtc_media_connection_leases WHERE id=$1", next.ID).Scan(&state); err != nil || state != "open" {
		t.Fatal("old close tore down replacement")
	}
	wrong := next
	wrong.Owner.Fence++
	if err := s.CloseLease(ctx, wrong, time.Now()); !errors.Is(err, media.ErrDenied) {
		t.Fatal("wrong owner fence closed lease")
	}
}

func TestMediaStorePreparedExpiryAndActivationIntent(t *testing.T) {
	for _, activate := range []bool{false, true} {
		t.Run(map[bool]string{false: "never_activated", true: "activation_intent"}[activate], func(t *testing.T) {
			db := mediaTestDatabase(t)
			s := NewMediaStore(db)
			call, group, user := mediaTestCall(t, db)
			g := mustMediaReserve(t, s, mediaTestRequest(call, group, user))
			ctx := context.Background()
			if activate {
				g = mustMediaActivate(t, s, g)
			}
			if _, err := s.ExpirePrepared(ctx, g.Key, g.PreparedAt.Add(19*time.Second)); !errors.Is(err, media.ErrDenied) {
				t.Fatal("early prepare expiry")
			}
			op, err := s.ExpirePrepared(ctx, g.Key, g.PreparedAt.Add(21*time.Second))
			if activate {
				if !errors.Is(err, media.ErrDenied) {
					t.Fatal("activation intent expired without SFU ACK")
				}
				current, _ := s.Get(ctx, g.GrantID)
				if current.State != "active" {
					t.Fatal("active lifetime changed")
				}
			} else {
				if err != nil || op.MediaState != "complete" || op.AuthorityOutcome != "unchanged" {
					t.Fatal("never-activated expiry failed")
				}
				var count int
				if err := db.QueryRow(ctx, "SELECT count(*) FROM rtc_media_cleanup_outbox").Scan(&count); err != nil || count != 0 {
					t.Fatal("never-activated journal fabricated SFU ACK")
				}
			}
		})
	}
}

func TestMediaStoreDurabilityFaultRollbackAndExhaustion(t *testing.T) {
	db := mediaTestDatabase(t)
	s := NewMediaStore(db)
	call, group, user := mediaTestCall(t, db)
	g := mustMediaActivate(t, s, mustMediaReserve(t, s, mediaTestRequest(call, group, user)))
	ctx := context.Background()
	if _, err := db.Exec(ctx, `CREATE FUNCTION reject_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned cleanup fault'; END $$; CREATE TRIGGER reject_cleanup BEFORE INSERT ON rtc_media_cleanup_outbox FOR EACH ROW EXECUTE FUNCTION reject_cleanup()`); err != nil {
		t.Fatal(err)
	}
	event := media.SourceEvent{Domain: "identity", Kind: "device", EventID: uuid.New(), SubjectID: g.DeviceID, DeviceID: g.DeviceID, UserID: user, Revision: 2, At: time.Now()}
	if _, err := s.ApplySourceEvent(ctx, event); err == nil {
		t.Fatal("outbox fault succeeded")
	}
	current, _ := s.Get(ctx, g.GrantID)
	if current.State != "active" {
		t.Fatal("failed outbox changed grant")
	}
	for _, table := range []string{"rtc_media_operations", "rtc_media_source_inbox", "rtc_media_deny_watermarks", "rtc_media_operation_targets"} {
		var count int
		if err := db.QueryRow(ctx, "SELECT count(*) FROM "+table).Scan(&count); err != nil || count != 0 {
			t.Fatal("outbox fault partially committed")
		}
	}
	if _, err := db.Exec(ctx, "DROP TRIGGER reject_cleanup ON rtc_media_cleanup_outbox"); err != nil {
		t.Fatal(err)
	}
	op, err := s.ApplySourceEvent(ctx, event)
	if err != nil {
		t.Fatal(err)
	}
	freshPool := namedTestPool(t, db, "restart")
	restarted := NewMediaStore(freshPool)
	current, err = restarted.Get(ctx, g.GrantID)
	if err != nil || current.State != "revoking" {
		t.Fatal("restart lost pending cleanup")
	}
	worker, now := uuid.New(), time.Now()
	claim, err := s.ClaimCleanup(ctx, op.ID, g.Key, "sfu", worker, now, now.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	replacement, err := restarted.ClaimCleanup(ctx, op.ID, g.Key, "sfu", uuid.New(), now.Add(2*time.Second), now.Add(time.Minute))
	if err != nil || replacement.Worker.Fence != claim.Worker.Fence+1 {
		t.Fatal("expired claim not recovered")
	}
	if _, err := s.RecordCleanupAcknowledgement(ctx, claim, now.Add(2*time.Second)); !errors.Is(err, media.ErrDenied) {
		t.Fatal("old worker fence accepted")
	}
	if err := s.RetryCleanup(ctx, replacement, now.Add(3*time.Second), "timeout"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RecordCleanupAcknowledgement(ctx, replacement, now.Add(3*time.Second)); !errors.Is(err, media.ErrDenied) {
		t.Fatal("pending retry ACK accepted")
	}
	final, err := s.ClaimCleanup(ctx, op.ID, g.Key, "sfu", uuid.New(), now.Add(4*time.Second), now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.RecordCleanupAcknowledgement(ctx, final, now.Add(5*time.Second)); err != nil {
		t.Fatal(err)
	}
	// No auth FK: historical opaque subject identifiers remain after source row deletion.
	if _, err := db.Exec(ctx, "DELETE FROM users WHERE id=$1", user); err == nil {
		t.Fatal("RTC participant RESTRICT must remain")
	}
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM rtc_media_source_inbox").Scan(&count); err != nil || count != 1 {
		t.Fatal("source history lost")
	}
	anotherCall, anotherGroup, anotherUser := mediaTestCall(t, db)
	if _, err := db.Exec(ctx, "INSERT INTO rtc_media_user_generations(user_id,next_generation) VALUES($1,$2)", anotherUser, int64(math.MaxInt64)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Reserve(ctx, mediaTestRequest(anotherCall, anotherGroup, anotherUser)); !errors.Is(err, media.ErrUnavailable) {
		t.Fatal("exhausted generation accepted")
	}
	for _, query := range []string{"SELECT count(*) FROM rtc_media_grants WHERE user_id=$1", "SELECT count(*) FROM rtc_media_deny_watermarks WHERE user_id=$1"} {
		var count int
		if err := db.QueryRow(ctx, query, anotherUser).Scan(&count); err != nil || count != 0 {
			t.Fatal("user exhaustion partially persisted grant/deny")
		}
	}
	var next int64
	if err := db.QueryRow(ctx, "SELECT next_generation FROM rtc_media_user_generations WHERE user_id=$1", anotherUser).Scan(&next); err != nil || next != math.MaxInt64 {
		t.Fatal("user exhaustion changed generation counter")
	}
}

func TestMediaStoreTransientCleanupDoesNotRevokeAuthority(t *testing.T) {
	db := mediaTestDatabase(t)
	s := NewMediaStore(db)
	call, group, user := mediaTestCall(t, db)
	g := mustMediaActivate(t, s, mustMediaReserve(t, s, mediaTestRequest(call, group, user)))
	ctx := context.Background()
	bad := g.Authority
	bad.EligibilityEpoch++
	if _, err := s.RegisterLease(ctx, g.Key, bad, uuid.New(), media.Owner{ID: uuid.New(), Fence: 1}, time.Now()); !errors.Is(err, media.ErrDenied) {
		t.Fatal("stale authority tuple accepted")
	}
	current, _ := s.Get(ctx, g.GrantID)
	if current.State != "active" {
		t.Fatal("single denied/unavailable admission changed active grant")
	}
	op, err := s.BeginRevoke(ctx, media.RevokeRequest{RequestID: uuid.New(), Key: g.Key, Reason: "unavailable", AuthorityOutcome: "unavailable", At: time.Now()})
	if err != nil || op.MediaState != "pending" || op.AuthorityOutcome != "unavailable" {
		t.Fatal("own exhausted recovery cleanup misreported source revoke")
	}
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM rtc_media_deny_watermarks").Scan(&count); err != nil || count != 0 {
		t.Fatal("transient own cleanup poisoned authority watermark")
	}
}

func TestMediaStoreFinalAckRollbackAndImmutableHistory(t *testing.T) {
	db := mediaTestDatabase(t)
	s := NewMediaStore(db)
	call, group, user := mediaTestCall(t, db)
	g := mustMediaActivate(t, s, mustMediaReserve(t, s, mediaTestRequest(call, group, user)))
	ctx := context.Background()
	for _, query := range []string{"UPDATE rtc_media_grants SET device_revision=2 WHERE id=$1", "UPDATE rtc_media_grants SET state='prepared' WHERE id=$1"} {
		if _, err := db.Exec(ctx, query, g.GrantID); err == nil {
			t.Fatal("binding/lifecycle rewrite accepted")
		}
	}
	op := mustMediaRevoke(t, s, g)
	claim := mustMediaClaim(t, s, op, g, "sfu")
	if _, err := db.Exec(ctx, `CREATE FUNCTION reject_media_call_end() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='ended' THEN RAISE EXCEPTION 'owned completion fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_media_call_end BEFORE UPDATE ON rtc_calls FOR EACH ROW EXECUTE FUNCTION reject_media_call_end()`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RecordCleanupAcknowledgement(ctx, claim, time.Now()); err == nil {
		t.Fatal("terminal call fault succeeded")
	}
	current, _ := s.Get(ctx, g.GrantID)
	if current.State != "revoking" {
		t.Fatal("failed final ACK released held grant")
	}
	var actionState, participantState string
	if err := db.QueryRow(ctx, "SELECT state FROM rtc_media_cleanup_outbox WHERE operation_id=$1", op.ID).Scan(&actionState); err != nil || actionState != "claimed" {
		t.Fatal("failed final ACK partially recorded")
	}
	if err := db.QueryRow(ctx, "SELECT state FROM rtc_call_participants WHERE id=$1", g.ParticipantID).Scan(&participantState); err != nil || participantState != "active" {
		t.Fatal("failed final ACK partially left participant")
	}
	if _, err := db.Exec(ctx, "DELETE FROM rtc_calls WHERE id=$1", call); err == nil {
		t.Fatal("pending history cascaded from call deletion")
	}
	if _, err := db.Exec(ctx, "DROP TRIGGER reject_media_call_end ON rtc_calls"); err != nil {
		t.Fatal(err)
	}
	done, err := s.RecordCleanupAcknowledgement(ctx, claim, time.Now())
	if err != nil || done.MediaState != "complete" {
		t.Fatal("final ACK retry failed")
	}
}

func TestMediaStoreHeldQuotaIndependentOfLegacyParticipation(t *testing.T) {
	db := mediaTestDatabase(t)
	s := NewMediaStore(db)
	call, group, user := mediaTestCall(t, db)
	ctx := context.Background()
	mustMediaReserve(t, s, mediaTestRequest(call, group, user))
	for i := 0; i < 3; i++ {
		u := uuid.New()
		if _, err := db.Exec(ctx, "INSERT INTO users(id) VALUES($1)", u); err != nil {
			t.Fatal(err)
		}
		mustMediaReserve(t, s, mediaTestRequest(call, group, u))
	}
	// Legacy mutation не может освободить media quota до trusted cleanup.
	if _, err := db.Exec(ctx, "UPDATE rtc_call_participants SET state='left',left_at=now() WHERE call_id=$1", call); err != nil {
		t.Fatal(err)
	}
	fifth := uuid.New()
	if _, err := db.Exec(ctx, "INSERT INTO users(id) VALUES($1)", fifth); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Reserve(ctx, mediaTestRequest(call, group, fifth)); !errors.Is(err, media.ErrConflict) {
		t.Fatal("legacy left rows released held media quota")
	}
	for _, check := range []struct {
		query string
		arg   uuid.UUID
		want  int
	}{{"SELECT count(*) FROM rtc_media_grants WHERE call_id=$1 AND state<>'revoked'", call, 4}, {"SELECT count(*) FROM rtc_media_rooms WHERE call_id=$1", call, 1}, {"SELECT count(*) FROM rtc_call_participants WHERE user_id=$1", fifth, 0}, {"SELECT count(*) FROM rtc_media_user_generations WHERE user_id=$1", fifth, 0}} {
		var count int
		if err := db.QueryRow(ctx, check.query, check.arg).Scan(&count); err != nil || count != check.want {
			t.Fatalf("quota rollback count=%d want=%d err=%v", count, check.want, err)
		}
	}
	snapshot, err := NewRepository(db).GetCallByID(ctx, call.String())
	if err != nil || snapshot.Status != "active" {
		t.Fatal("quota denial ended call")
	}
}

func TestMediaStoreRoomExhaustionUnavailableNoWatermark(t *testing.T) {
	db := mediaTestDatabase(t)
	s := NewMediaStore(db)
	call, group, user := mediaTestCall(t, db)
	ctx := context.Background()
	if _, err := db.Exec(ctx, "INSERT INTO rtc_media_rooms(id,call_id,group_id,room_generation,room_name,state,created_at,closed_at) VALUES($1,$2,$3,$4,$5,'closed',now(),now())", uuid.New(), call, group, int64(math.MaxInt64-1), uuid.New()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Reserve(ctx, mediaTestRequest(call, group, user)); !errors.Is(err, media.ErrUnavailable) {
		t.Fatal("room exhaustion misreported permanent authority deny")
	}
	for _, table := range []string{"rtc_media_grants", "rtc_media_user_generations", "rtc_media_deny_watermarks"} {
		var count int
		if err := db.QueryRow(ctx, "SELECT count(*) FROM "+table).Scan(&count); err != nil || count != 0 {
			t.Fatal("exhaustion wrote partial authority state")
		}
	}
}
