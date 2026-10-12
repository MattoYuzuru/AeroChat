package delivery

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"math"
	"testing"
	"time"

	"github.com/google/uuid"
)

type fakeRepository struct {
	claim     *Claim
	exhausted bool
	claimErr  error
	reason    string
	retry     int32
	completed int
	casErr    error
}

func (r *fakeRepository) Claim(context.Context, uuid.UUID) (*Claim, error) {
	return r.claim, r.claimErr
}
func (r *fakeRepository) HasExhausted(context.Context) (bool, error) { return r.exhausted, nil }
func (r *fakeRepository) Complete(_ context.Context, _ Claim, _ Receipt) error {
	r.completed++
	return r.casErr
}
func (r *fakeRepository) Quarantine(_ context.Context, _ Claim, reason string) error {
	r.reason = reason
	return r.casErr
}
func (r *fakeRepository) Retry(_ context.Context, _ Claim, seconds int32) error {
	r.retry = seconds
	return r.casErr
}

type fakeClient struct {
	lookupResult        *Receipt
	result              Receipt
	applyErr, lookupErr error
	apply, lookup       int
	block               bool
}

func (c *fakeClient) Apply(ctx context.Context, _ Event) (Receipt, error) {
	c.apply++
	if c.block {
		<-ctx.Done()
		return Receipt{}, ctx.Err()
	}
	return c.result, c.applyErr
}
func (c *fakeClient) Lookup(context.Context, uuid.UUID) (Receipt, error) {
	c.lookup++
	if c.lookupResult != nil {
		return *c.lookupResult, c.lookupErr
	}
	return c.result, c.lookupErr
}
func goodClaim() *Claim {
	subject := uuid.New()
	return &Claim{Event: Event{ID: uuid.New(), SubjectID: subject, SessionID: subject, UserID: uuid.New(), DeviceID: uuid.New(), Kind: "session", Revision: 2}, Owner: uuid.New(), Fence: 1, Attempt: 1}
}
func goodReceipt(c *Claim) Receipt {
	return Receipt{EventID: c.Event.ID, OperationID: uuid.New(), Effect: "no_matching_registry_grants"}
}
func workerFor(r Repository, c Client) *Worker {
	return NewWorker(r, c, slog.New(slog.NewTextHandler(io.Discard, nil)))
}
func TestDeliveryFirstAttemptAndRecoveredReceipt(t *testing.T) {
	for _, attempt := range []int64{1, 2} {
		r := &fakeRepository{claim: goodClaim()}
		r.claim.Attempt = attempt
		c := &fakeClient{result: goodReceipt(r.claim)}
		if err := workerFor(r, c).Step(context.Background()); err != nil {
			t.Fatal(err)
		}
		if r.completed != 1 || r.retry != 0 || r.reason != "" {
			t.Fatal("durable receipt did not complete only journal")
		}
		if attempt == 1 && (c.apply != 1 || c.lookup != 0) || attempt == 2 && (c.apply != 1 || c.lookup != 1) {
			t.Fatal("recovery did not use own receipt first")
		}
	}
}
func TestDeliveryMissingReceiptReplaysAndUnavailableDoesNotApply(t *testing.T) {
	for _, lookupErr := range []error{ErrNotFound, ErrUnavailable} {
		r := &fakeRepository{claim: goodClaim()}
		r.claim.Attempt = 2
		c := &fakeClient{lookupErr: lookupErr, result: goodReceipt(r.claim)}
		err := workerFor(r, c).Step(context.Background())
		if lookupErr == ErrNotFound {
			if err != nil || c.apply != 1 || r.completed != 1 {
				t.Fatal("missing receipt did not replay")
			}
		} else if !errors.Is(err, ErrUnavailable) || c.apply != 0 || r.completed != 0 || r.retry != 2 {
			t.Fatal("transient lookup changed delivery")
		}
	}
}
func TestDeliveryQuarantineAndStaleOwnerCAS(t *testing.T) {
	for _, reason := range []string{"canonical_conflict", "source_row_invalid"} {
		r := &fakeRepository{claim: goodClaim()}
		c := &fakeClient{applyErr: ErrConflict}
		if reason == "source_row_invalid" {
			r.claim.Event.ID = uuid.Nil
		}
		if err := workerFor(r, c).Step(context.Background()); err != nil {
			t.Fatal(err)
		}
		if r.reason != reason || r.completed != 0 || r.retry != 0 {
			t.Fatal("permanent event must quarantine")
		}
		if reason == "source_row_invalid" && c.apply+c.lookup != 0 {
			t.Fatal("malformed source row reached client")
		}
		r.casErr = ErrStaleClaim
		if err := workerFor(r, c).Step(context.Background()); !errors.Is(err, ErrStaleClaim) {
			t.Fatal("stale quarantine CAS accepted")
		}
	}
}
func TestDeliveryInvalidReceiptCannotComplete(t *testing.T) {
	mutations := []func(*Receipt){func(r *Receipt) { r.EventID = uuid.New() }, func(r *Receipt) { r.OperationID = uuid.Nil }, func(r *Receipt) { r.Effect = "media_complete" }, func(r *Receipt) { r.Count = 1 }, func(r *Receipt) { r.Effect = "media_pending"; r.Count = 0 }, func(r *Receipt) { r.Count = -1 }}
	for _, mutate := range mutations {
		r := &fakeRepository{claim: goodClaim()}
		response := goodReceipt(r.claim)
		mutate(&response)
		c := &fakeClient{result: response}
		if err := workerFor(r, c).Step(context.Background()); !errors.Is(err, ErrUnavailable) {
			t.Fatal("invalid receipt accepted")
		}
		if r.completed != 0 || r.retry != 1 || r.reason != "" {
			t.Fatal("invalid response must stay retryable")
		}
	}
}
func TestDeliveryDeadlinePreservesClaimForTakeover(t *testing.T) {
	r := &fakeRepository{claim: goodClaim()}
	c := &fakeClient{block: true}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := workerFor(r, c).Step(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
	if r.completed != 0 || r.retry != 0 || r.reason != "" {
		t.Fatal("expired attempt must not alter durable claim")
	}
}
func TestDeliveryExhaustionAndBackoff(t *testing.T) {
	r := &fakeRepository{exhausted: true}
	if err := workerFor(r, &fakeClient{}).Step(context.Background()); !errors.Is(err, ErrExhausted) {
		t.Fatal("exhaustion must be diagnosed")
	}
	for _, attempt := range []int64{0, 1, 2, 5, 6, math.MaxInt64} {
		value := RetrySeconds(attempt)
		if value < 1 || value > 30 {
			t.Fatal("retry overflow")
		}
		if attempt == math.MaxInt64 && value != 30 {
			t.Fatal("retry must cap without shifting")
		}
	}
}

func TestDeliveryRecoveryRequiresMatchingCanonicalReplay(t *testing.T) {
	r := &fakeRepository{claim: goodClaim()}
	r.claim.Attempt = 2
	found := goodReceipt(r.claim)
	applied := found
	applied.OperationID = uuid.New()
	c := &fakeClient{result: applied, lookupResult: &found}
	if err := workerFor(r, c).Step(context.Background()); !errors.Is(err, ErrUnavailable) {
		t.Fatal("changed operation accepted")
	}
	if c.apply != 1 || c.lookup != 1 || r.completed != 0 || r.retry != 2 {
		t.Fatal("lookup bypassed canonical replay")
	}
	c.applyErr = ErrConflict
	r.retry = 0
	if err := workerFor(r, c).Step(context.Background()); err != nil {
		t.Fatal(err)
	}
	if r.reason != "canonical_conflict" || r.completed != 0 || r.retry != 0 {
		t.Fatal("recovered canonical conflict not quarantined")
	}
}
