package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"sort"
	"testing"
	"time"

	rtcschema "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/db/schema"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/admission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func registrationDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	db := mediaTestDatabase(t)
	schema, err := rtcschema.Files.ReadFile("000002_media_admission_instances.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(context.Background(), string(schema)); err != nil {
		t.Fatal(err)
	}
	return db
}
func registrationActor(t *testing.T, ctx context.Context, db *pgxpool.Pool, suffix string) (*pgxpool.Pool, int32) {
	t.Helper()
	cfg := db.Config().Copy()
	cfg.MaxConns = 1
	cfg.ConnConfig.RuntimeParams["application_name"] += "_" + suffix
	actor, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(actor.Close)
	var pid int32
	if err := actor.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&pid); err != nil {
		t.Fatal(err)
	}
	return actor, pid
}

type registrationLockActor struct {
	pid         int32
	application string
}

type registrationObservedLock struct {
	Type          string `json:"type"`
	Mode          string `json:"mode"`
	Relation      uint32 `json:"relation"`
	TransactionID string `json:"transaction_id"`
	VirtualXID    string `json:"virtual_xid"`
	Granted       bool   `json:"granted"`
}

type registrationLockNode struct {
	PID         int32
	Application string
	Database    string
	State       string
	WaitType    string
	WaitEvent   string
	Blockers    []int32
	Locks       []registrationObservedLock
}

// Direct blocker не обязан быть locker: worker может ждать другого owned worker.
func registrationLockPaths(nodes []registrationLockNode, locker registrationLockActor, actors []registrationLockActor, database string, fenceOID uint32) (map[int32][]int32, string) {
	if len(actors) != 2 || len(nodes) != 3 || fenceOID == 0 {
		return nil, "exact owned root and two workers required"
	}
	expected := map[int32]string{locker.pid: locker.application}
	if locker.pid <= 0 || locker.application == "" || database == "" {
		return nil, "invalid root identity"
	}
	for _, actor := range actors {
		if actor.pid <= 0 || actor.application == "" {
			return nil, "invalid worker identity"
		}
		if _, exists := expected[actor.pid]; exists {
			return nil, "duplicate owned pid"
		}
		expected[actor.pid] = actor.application
	}
	byPID := make(map[int32]registrationLockNode, 3)
	for _, node := range nodes {
		application, exists := expected[node.PID]
		if !exists || node.Application != application || node.Database != database {
			return nil, "database/application identity mismatch"
		}
		if _, duplicate := byPID[node.PID]; duplicate {
			return nil, "duplicate observed pid"
		}
		byPID[node.PID] = node
	}
	root := byPID[locker.pid]
	if len(root.Blockers) != 0 {
		return nil, "root locker is not terminal"
	}
	rootFence := false
	for _, lock := range root.Locks {
		if lock.Granted && lock.Type == "relation" && lock.Relation == fenceOID && lock.Mode == "RowShareLock" {
			rootFence = true
		}
	}
	if !rootFence {
		return nil, "root fence relation lock not observed"
	}
	for _, actor := range actors {
		node := byPID[actor.pid]
		if node.State != "active" || node.WaitType != "Lock" || len(node.Blockers) == 0 {
			return nil, "worker is not executing a blocked lock request"
		}
		waitingLock := false
		for _, lock := range node.Locks {
			if lock.Granted {
				continue
			}
			if (lock.Type == "tuple" && lock.Relation == fenceOID) ||
				(lock.Type == "transactionid" && lock.TransactionID != "") ||
				(lock.Type == "virtualxid" && lock.VirtualXID != "") {
				waitingLock = true
			}
		}
		if !waitingLock {
			return nil, "worker ungranted fence row/transaction lock not observed"
		}
		for _, blocker := range node.Blockers {
			if _, owned := expected[blocker]; !owned || blocker == node.PID {
				return nil, "zero/foreign/self blocker rejected"
			}
		}
	}
	paths := make(map[int32][]int32, 2)
	var walk func(int32, map[int32]bool) ([]int32, bool)
	walk = func(pid int32, visited map[int32]bool) ([]int32, bool) {
		if pid == locker.pid {
			return []int32{pid}, true
		}
		if visited[pid] {
			return nil, false
		}
		visited[pid] = true
		defer delete(visited, pid)
		var witness []int32
		for _, blocker := range byPID[pid].Blockers {
			path, reachesRoot := walk(blocker, visited)
			if !reachesRoot {
				return nil, false
			}
			if witness == nil {
				witness = append([]int32{pid}, path...)
			}
		}
		return witness, witness != nil
	}
	for _, actor := range actors {
		path, reachesRoot := walk(actor.pid, make(map[int32]bool, 3))
		if !reachesRoot {
			return nil, "cycle or disconnected worker path"
		}
		paths[actor.pid] = path
	}
	return paths, ""
}

func registrationLockWitness(nodes []registrationLockNode, paths map[int32][]int32, reason string) string {
	// Исключаем query text, credentials и domain payload: только PID/lock metadata.
	type nodeWitness struct {
		PID       int32                      `json:"pid"`
		State     string                     `json:"state"`
		WaitType  string                     `json:"wait_type"`
		WaitEvent string                     `json:"wait_event"`
		Blockers  []int32                    `json:"blockers"`
		Locks     []registrationObservedLock `json:"locks"`
	}
	witness := make([]nodeWitness, 0, len(nodes))
	for _, node := range nodes {
		witness = append(witness, nodeWitness{node.PID, node.State, node.WaitType, node.WaitEvent, node.Blockers, node.Locks})
	}
	encoded, err := json.Marshal(struct {
		Nodes  []nodeWitness     `json:"nodes"`
		Paths  map[int32][]int32 `json:"paths"`
		Reason string            `json:"reason"`
	}{witness, paths, reason})
	if err != nil {
		return "lock metadata encoding failed"
	}
	return string(encoded)
}

func registrationWait(t *testing.T, ctx context.Context, db *pgxpool.Pool, locker int32, actors ...registrationLockActor) {
	t.Helper()
	root := registrationLockActor{locker, db.Config().ConnConfig.RuntimeParams["application_name"]}
	pids := []int32{locker}
	for _, actor := range actors {
		pids = append(pids, actor.pid)
	}
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	var fenceOID uint32
	if err := db.QueryRow(ctx, "SELECT 'rtc_admission_fence'::regclass::oid").Scan(&fenceOID); err != nil {
		t.Fatal("registration fence relation identity unavailable")
	}
	last := "no lock sample"
	for {
		rows, err := db.Query(ctx, `SELECT a.pid,a.application_name,a.datname,a.state,
COALESCE(a.wait_event_type,''),COALESCE(a.wait_event,''),pg_blocking_pids(a.pid),
COALESCE((SELECT jsonb_agg(jsonb_build_object('type',l.locktype,'mode',l.mode,
'relation',l.relation,'transaction_id',COALESCE(l.transactionid::text,''),
'virtual_xid',COALESCE(l.virtualxid,''),'granted',l.granted))
FROM pg_locks l WHERE l.pid=a.pid AND l.locktype IN ('relation','tuple','transactionid','virtualxid')), '[]'::jsonb)
FROM pg_stat_activity a WHERE a.pid=ANY($1::int[]) ORDER BY a.pid`, pids)
		if err != nil {
			t.Fatalf("registration lock sample failed; last=%s", last)
		}
		nodes := make([]registrationLockNode, 0, 3)
		for rows.Next() {
			var node registrationLockNode
			var locksJSON []byte
			if err := rows.Scan(&node.PID, &node.Application, &node.Database, &node.State, &node.WaitType, &node.WaitEvent, &node.Blockers, &locksJSON); err != nil {
				rows.Close()
				t.Fatal("registration lock sample decode failed")
			}
			if err := json.Unmarshal(locksJSON, &node.Locks); err != nil {
				rows.Close()
				t.Fatal("registration lock metadata decode failed")
			}
			sort.Slice(node.Blockers, func(i, j int) bool { return node.Blockers[i] < node.Blockers[j] })
			nodes = append(nodes, node)
		}
		readErr := rows.Err()
		rows.Close()
		if readErr != nil {
			t.Fatal("registration lock sample read failed")
		}
		paths, reason := registrationLockPaths(nodes, root, actors, db.Config().ConnConfig.Database, fenceOID)
		last = registrationLockWitness(nodes, paths, reason)
		if reason == "" {
			t.Logf("owned registration lock graph: %s", last)
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("registration lock context canceled; last=%s", last)
		case <-deadline.C:
			t.Fatalf("owned registration locks not observed; last=%s", last)
		case <-ticker.C:
		}
	}
}
func TestAdmissionRegistrationConcurrentReplayAndDistinctNonce(t *testing.T) {
	db := registrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	a, pidA := registrationActor(t, ctx, db, "register_a")
	b, pidB := registrationActor(t, ctx, db, "register_b")
	if pidA == pidB {
		t.Fatal("independent backends required")
	}
	lock, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		_ = lock.Rollback(cleanup)
	}()
	if _, err := lock.Exec(ctx, "SELECT last_fence FROM rtc_admission_fence WHERE singleton=TRUE FOR UPDATE"); err != nil {
		t.Fatal(err)
	}
	var locker int32
	if err := lock.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&locker); err != nil {
		t.Fatal(err)
	}
	leaf := [32]byte{1}
	request := uuid.New()
	type result struct {
		instance *admission.Instance
		err      error
	}
	results := make(chan result, 2)
	for _, actor := range []*pgxpool.Pool{a, b} {
		go func(db *pgxpool.Pool) {
			i, e := NewRegistrationStore(db).Register(ctx, leaf, request)
			results <- result{i, e}
		}(actor)
	}
	registrationWait(t, ctx, db, locker, registrationLockActor{pidA, a.Config().ConnConfig.RuntimeParams["application_name"]}, registrationLockActor{pidB, b.Config().ConnConfig.RuntimeParams["application_name"]})
	if err := lock.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var instances []*admission.Instance
	for range 2 {
		select {
		case r := <-results:
			if r.err != nil || r.instance == nil {
				t.Fatal("concurrent registration failed")
			}
			instances = append(instances, r.instance)
		case <-ctx.Done():
			t.Fatal("registration did not release")
		}
	}
	if instances[0].ID != instances[1].ID || instances[0].Fence != 1 || instances[1].Fence != 1 {
		t.Fatal("identical retry allocated twice")
	}
	if _, err := NewRegistrationStore(db).Register(ctx, leaf, uuid.New()); !errors.Is(err, admission.ErrConflict) {
		t.Fatal("distinct nonce reused leaf")
	}
	other, err := NewRegistrationStore(db).Register(ctx, [32]byte{2}, request)
	if err != nil || other.Fence != 2 || other.ID == instances[0].ID {
		t.Fatal("same nonce another leaf gained old instance")
	}
	lock2, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		_ = lock2.Rollback(cleanup)
	}()
	if _, err := lock2.Exec(ctx, "SELECT last_fence FROM rtc_admission_fence WHERE singleton=TRUE FOR UPDATE"); err != nil {
		t.Fatal(err)
	}
	if err := lock2.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&locker); err != nil {
		t.Fatal(err)
	}
	distinctLeaf := [32]byte{7}
	for _, actor := range []*pgxpool.Pool{a, b} {
		go func(db *pgxpool.Pool) {
			i, e := NewRegistrationStore(db).Register(ctx, distinctLeaf, uuid.New())
			results <- result{i, e}
		}(actor)
	}
	registrationWait(t, ctx, db, locker, registrationLockActor{pidA, a.Config().ConnConfig.RuntimeParams["application_name"]}, registrationLockActor{pidB, b.Config().ConnConfig.RuntimeParams["application_name"]})
	if err := lock2.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	successes, conflicts := 0, 0
	for range 2 {
		select {
		case r := <-results:
			if r.err == nil && r.instance != nil && r.instance.Fence == 3 {
				successes++
			} else if errors.Is(r.err, admission.ErrConflict) {
				conflicts++
			} else {
				t.Fatal("unexpected duplicate-leaf result")
			}
		case <-ctx.Done():
			t.Fatal("distinct request registration did not release")
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatal("concurrent distinct nonce allocated twice")
	}
	var count int
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM rtc_admission_instances").Scan(&count); err != nil || count != 3 {
		t.Fatal("unexpected registration allocation count")
	}
}
func TestAdmissionRegistrationOverflowRollbackAndInactiveRetry(t *testing.T) {
	db := registrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	store := NewRegistrationStore(db)
	leaf := [32]byte{3}
	request := uuid.New()
	saved, err := store.Register(ctx, leaf, request)
	if err != nil {
		t.Fatal(err)
	}
	for _, state := range []string{"draining", "retired"} {
		if _, err := db.Exec(ctx, "UPDATE rtc_admission_instances SET state=$2 WHERE leaf_fingerprint=$1", leaf[:], state); err != nil {
			t.Fatal(err)
		}
		retry, err := store.Register(ctx, leaf, request)
		if err != nil || retry.ID != saved.ID || retry.Fence != saved.Fence || retry.State != state {
			t.Fatal("inactive replay reallocated/reactivated")
		}
		if _, err := store.Register(ctx, leaf, uuid.New()); !errors.Is(err, admission.ErrConflict) {
			t.Fatal("inactive leaf accepted new nonce")
		}
	}
	if _, err := db.Exec(ctx, "UPDATE rtc_admission_instances SET state='active' WHERE leaf_fingerprint=$1", leaf[:]); err == nil {
		t.Fatal("retired registration reactivated")
	}
	if _, err := db.Exec(ctx, "CREATE FUNCTION reject_registration_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned registration fault'; END $$; CREATE TRIGGER reject_registration_insert BEFORE INSERT ON rtc_admission_instances FOR EACH ROW EXECUTE FUNCTION reject_registration_insert()"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Register(ctx, [32]byte{4}, uuid.New()); !errors.Is(err, admission.ErrUnavailable) {
		t.Fatal("insert fault not mapped unavailable")
	}
	var fence int64
	if err := db.QueryRow(ctx, "SELECT last_fence FROM rtc_admission_fence").Scan(&fence); err != nil || fence != 1 {
		t.Fatal("failed insert advanced fence")
	}
	if _, err := db.Exec(ctx, "DROP TRIGGER reject_registration_insert ON rtc_admission_instances"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, "UPDATE rtc_admission_fence SET last_fence=$1", int64(math.MaxInt64)); err != nil {
		t.Fatal(err)
	}
	var before, after string
	if err := db.QueryRow(ctx, "SELECT to_jsonb(f)::text FROM rtc_admission_fence f").Scan(&before); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Register(ctx, [32]byte{5}, uuid.New()); !errors.Is(err, admission.ErrUnavailable) {
		t.Fatal("exhaustion not failclosed")
	}
	if err := db.QueryRow(ctx, "SELECT to_jsonb(f)::text FROM rtc_admission_fence f").Scan(&after); err != nil || before != after {
		t.Fatal("exhaustion mutated sequence")
	}
	retry, err := store.Register(ctx, leaf, request)
	if err != nil || retry.ID != saved.ID || retry.Fence != 1 || retry.State != "retired" {
		t.Fatal("saved retry denied at exhaustion")
	}
	restarted, err := pgxpool.NewWithConfig(ctx, db.Config().Copy())
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	durable, err := NewRegistrationStore(restarted).Register(ctx, leaf, request)
	if err != nil || *durable != *retry {
		t.Fatal("registration lost across repository/pool restart")
	}
}
