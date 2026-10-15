package postgres

import (
	"context"
	"testing"
	"time"

	media "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediastore"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/rtc"
	ql "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/storage/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Legacy bootstrap fixture записывает старую schema primitive SQLC queries.
// Current writers требуют registered003 до startup и не имитируют old-runtime compatibility.
func createLegacyControlFixtureCall(t *testing.T, db *pgxpool.Pool, call rtc.Call, p rtc.CallParticipant) (*rtc.Call, *rtc.CallParticipant, error) {
	t.Helper()
	q := ql.New(db)
	ctx := context.Background()
	row, err := q.CreateCall(ctx, ql.CreateCallParams{ID: mustParseUUID(call.ID), ScopeType: call.Scope.Type, DirectChatID: uuidValue(call.Scope.DirectChatID), GroupID: uuidValue(call.Scope.GroupID), CreatedByUserID: mustParseUUID(call.CreatedByUserID), Status: call.Status, CreatedAt: timestamptzValue(call.CreatedAt), StartedAt: timestamptzValue(call.StartedAt), UpdatedAt: timestamptzValue(call.UpdatedAt)})
	if err != nil {
		return nil, nil, err
	}
	part, err := q.CreateParticipant(ctx, ql.CreateParticipantParams{ID: mustParseUUID(p.ID), CallID: mustParseUUID(p.CallID), UserID: mustParseUUID(p.UserID), State: p.State, JoinedAt: timestamptzValue(p.JoinedAt), UpdatedAt: timestamptzValue(p.UpdatedAt)})
	if err != nil {
		return nil, nil, err
	}
	c := toDomainCallFromBase(row)
	c.ActiveParticipantCount = 1
	participant := toDomainParticipant(part)
	return c, &participant, nil
}
func createLegacyControlFixtureParticipant(ctx context.Context, db *pgxpool.Pool, p rtc.CallParticipant) error {
	_, err := ql.New(db).CreateParticipant(ctx, ql.CreateParticipantParams{ID: mustParseUUID(p.ID), CallID: mustParseUUID(p.CallID), UserID: mustParseUUID(p.UserID), State: p.State, JoinedAt: timestamptzValue(p.JoinedAt), UpdatedAt: timestamptzValue(p.UpdatedAt)})
	return err
}
func createLegacyControlFixtureGrant(t *testing.T, db *pgxpool.Pool, call, group, user uuid.UUID) media.Grant {
	t.Helper()
	q := ql.New(db)
	ctx := context.Background()
	r := mediaTestRequest(call, group, user)
	p, err := q.GetActiveParticipantByCallIDAndUserID(ctx, ql.GetActiveParticipantByCallIDAndUserIDParams{CallID: call, UserID: user})
	if err != nil {
		t.Fatal(err)
	}
	room, err := q.CreateMediaRoom(ctx, ql.CreateMediaRoomParams{ID: uuid.New(), CallID: call, GroupID: group, RoomGeneration: 1, RoomName: uuid.New(), CreatedAt: timestamptzValue(r.At)})
	if err != nil {
		t.Fatal(err)
	}
	if err := q.EnsureMediaUserMutex(ctx, user); err != nil {
		t.Fatal(err)
	}
	generation, err := q.AllocateMediaGrantGeneration(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	grant, err := q.CreateMediaGrant(ctx, ql.CreateMediaGrantParams{ID: uuid.New(), RequestID: r.RequestID, RoomID: room.ID, CallID: call, ParticipantID: p.ID, GroupID: group, UserID: user, SessionID: r.SessionID, DeviceID: r.DeviceID, SessionRevision: r.SessionRevision, DeviceRevision: r.DeviceRevision, EligibilityEpoch: r.EligibilityEpoch, GrantGeneration: generation, ParticipantIdentity: uuid.New(), PreparedAt: timestamptzValue(r.At)})
	if err != nil {
		t.Fatal(err)
	}
	if n, err := q.ActivateMediaGrant(ctx, ql.ActivateMediaGrantParams{ID: grant.ID, ActivationIntentAt: timestamptzValue(r.At)}); err != nil || n != 1 {
		t.Fatal("legacy activation fixture", err)
	}
	if err := q.ActivateMediaRoom(ctx, room.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := q.CreateMediaLease(ctx, ql.CreateMediaLeaseParams{ID: uuid.New(), GrantID: grant.ID, OwnerID: uuid.New(), OwnerFence: 1, ConnectedAt: timestamptzValue(time.Now())}); err != nil {
		t.Fatal(err)
	}
	row, err := q.GetMediaGrant(ctx, grant.ID)
	if err != nil {
		t.Fatal(err)
	}
	return grantFromRow(row)
}
