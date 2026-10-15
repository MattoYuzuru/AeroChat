package postgres

import (
	"strings"
	"testing"
)

func registrationGraphFixture() ([]registrationLockNode, registrationLockActor, []registrationLockActor) {
	root := registrationLockActor{200, "fixture"}
	actors := []registrationLockActor{{201, "fixture_register_a"}, {202, "fixture_register_b"}}
	nodes := []registrationLockNode{
		{PID: 200, Application: root.application, Database: "aerochat_rtc_test", State: "idle in transaction", Locks: []registrationObservedLock{{Type: "relation", Mode: "RowShareLock", Relation: 99, Granted: true}}},
		{PID: 201, Application: actors[0].application, Database: "aerochat_rtc_test", State: "active", WaitType: "Lock", WaitEvent: "transactionid", Blockers: []int32{200}, Locks: []registrationObservedLock{{Type: "transactionid", Mode: "ShareLock", TransactionID: "501"}}},
		{PID: 202, Application: actors[1].application, Database: "aerochat_rtc_test", State: "active", WaitType: "Lock", WaitEvent: "tuple", Blockers: []int32{201}, Locks: []registrationObservedLock{{Type: "tuple", Mode: "AccessExclusiveLock", Relation: 99}}},
	}
	return nodes, root, actors
}

func TestRegistrationLockGraphOwnedChainValidation(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func([]registrationLockNode, []registrationLockActor) []registrationLockNode
		valid  bool
	}{
		{"owned-worker-chain", func(n []registrationLockNode, _ []registrationLockActor) []registrationLockNode { return n }, true},
		{"both-direct-root", func(n []registrationLockNode, _ []registrationLockActor) []registrationLockNode {
			n[2].Blockers = []int32{200}
			return n
		}, true},
		{"reverse-owned-chain", func(n []registrationLockNode, _ []registrationLockActor) []registrationLockNode {
			n[1].Blockers = []int32{202}
			n[2].Blockers = []int32{200}
			return n
		}, true},
		{"duplicate-client-visible-blocker", func(n []registrationLockNode, _ []registrationLockActor) []registrationLockNode {
			n[1].Blockers = []int32{200, 200}
			return n
		}, true},
		{"missing-worker", func(n []registrationLockNode, _ []registrationLockActor) []registrationLockNode { return n[:2] }, false},
		{"duplicate-actor-pid", func(n []registrationLockNode, a []registrationLockActor) []registrationLockNode {
			a[1].pid = a[0].pid
			return n
		}, false},
		{"duplicate-observed-pid", func(n []registrationLockNode, _ []registrationLockActor) []registrationLockNode {
			n[2] = n[1]
			return n
		}, false},
		{"wrong-owned-application", func(n []registrationLockNode, _ []registrationLockActor) []registrationLockNode {
			n[2].Application = "foreign"
			return n
		}, false},
		{"wrong-owned-database", func(n []registrationLockNode, _ []registrationLockActor) []registrationLockNode {
			n[1].Database = "foreign"
			return n
		}, false},
		{"foreign-pid-even-with-root-path", func(n []registrationLockNode, _ []registrationLockActor) []registrationLockNode {
			n[1].Blockers = []int32{200, 999}
			return n
		}, false},
		{"prepared-zero-even-with-root-path", func(n []registrationLockNode, _ []registrationLockActor) []registrationLockNode {
			n[1].Blockers = []int32{200, 0}
			return n
		}, false},
		{"self-blocker-even-with-root-path", func(n []registrationLockNode, _ []registrationLockActor) []registrationLockNode {
			n[1].Blockers = []int32{200, 201}
			return n
		}, false},
		{"cycle-even-with-root-path", func(n []registrationLockNode, _ []registrationLockActor) []registrationLockNode {
			n[1].Blockers = []int32{200, 202}
			return n
		}, false},
		{"worker-not-active", func(n []registrationLockNode, _ []registrationLockActor) []registrationLockNode {
			n[2].State = "idle"
			return n
		}, false},
		{"worker-not-lock-waiting", func(n []registrationLockNode, _ []registrationLockActor) []registrationLockNode {
			n[2].WaitType = "Client"
			return n
		}, false},
		{"worker-no-blockers", func(n []registrationLockNode, _ []registrationLockActor) []registrationLockNode {
			n[2].Blockers = nil
			return n
		}, false},
		{"worker-only-granted-lock", func(n []registrationLockNode, _ []registrationLockActor) []registrationLockNode {
			n[2].Locks[0].Granted = true
			return n
		}, false},
		{"worker-wrong-tuple-relation", func(n []registrationLockNode, _ []registrationLockActor) []registrationLockNode {
			n[2].Locks[0].Relation = 98
			return n
		}, false},
		{"worker-empty-transaction-id", func(n []registrationLockNode, _ []registrationLockActor) []registrationLockNode {
			n[1].Locks[0].TransactionID = ""
			return n
		}, false},
		{"root-not-fence-locker", func(n []registrationLockNode, _ []registrationLockActor) []registrationLockNode {
			n[0].Locks[0].Relation = 98
			return n
		}, false},
		{"root-waits-on-worker", func(n []registrationLockNode, _ []registrationLockActor) []registrationLockNode {
			n[0].Blockers = []int32{201}
			return n
		}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			nodes, root, actors := registrationGraphFixture()
			nodes = test.change(nodes, actors)
			paths, reason := registrationLockPaths(nodes, root, actors, "aerochat_rtc_test", 99)
			if (reason == "") != test.valid {
				t.Fatalf("valid=%v reason=%s", test.valid, reason)
			}
			if test.valid {
				for _, actor := range actors {
					path := paths[actor.pid]
					if len(path) < 2 || len(path) > 3 || path[0] != actor.pid || path[len(path)-1] != root.pid {
						t.Fatal("each owned worker needs a directed path to the exact root")
					}
				}
			}
		})
	}
}

func TestRegistrationLockWitnessOmitsPrivateContextFields(t *testing.T) {
	nodes, _, _ := registrationGraphFixture()
	nodes[0].Application = "private-application"
	nodes[0].Database = "private-database"
	encoded := registrationLockWitness(nodes, map[int32][]int32{201: {201, 200}}, "ownership mismatch")
	if strings.Contains(encoded, "private-application") || strings.Contains(encoded, "private-database") {
		t.Fatal("private context fields included in lock witness")
	}
	if !strings.Contains(encoded, `"pid":200`) || !strings.Contains(encoded, `"blockers":[201]`) || !strings.Contains(encoded, `"paths"`) {
		t.Fatal("PID/lock graph metadata missing from witness")
	}
}
