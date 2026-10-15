package delivery

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"io"
	"log/slog"
	"math"
	"testing"
	"time"
)

type fakeRepository struct {
	claim     *Claim
	exhausted bool
	completed int
	retry     int32
	reason    string
	casErr    error
}

func (r *fakeRepository) Claim(context.Context, uuid.UUID) (*Claim, error) { return r.claim, nil }
func (r *fakeRepository) HasExhausted(context.Context) (bool, error)       { return r.exhausted, nil }
func (r *fakeRepository) Complete(context.Context, Claim, Receipt) error {
	r.completed++
	return r.casErr
}
func (r *fakeRepository) Retry(_ context.Context, _ Claim, seconds int32) error {
	r.retry = seconds
	return r.casErr
}
func (r *fakeRepository) Quarantine(_ context.Context, _ Claim, reason string) error {
	r.reason = reason
	return r.casErr
}

type fakeClient struct {
	result              Receipt
	found               *Receipt
	lookupErr, applyErr error
	lookup, apply       int
	block               bool
}

func (c *fakeClient) Lookup(context.Context, uuid.UUID) (Receipt, error) {
	c.lookup++
	if c.found != nil {
		return *c.found, c.lookupErr
	}
	return c.result, c.lookupErr
}
func (c *fakeClient) Apply(ctx context.Context, _ Event) (Receipt, error) {
	c.apply++
	if c.block {
		<-ctx.Done()
		return Receipt{}, ctx.Err()
	}
	return c.result, c.applyErr
}
func goodClaim() *Claim {
	return &Claim{Event: Event{ID: uuid.New(), GroupID: uuid.New(), UserID: uuid.New(), Epoch: 2, SourceReason: "eligibility_denied"}, Owner: uuid.New(), Fence: 1, Attempt: 1}
}
func goodReceipt(c *Claim) Receipt {
	return Receipt{EventID: c.Event.ID, OperationID: uuid.New(), Effect: "no_matching_registry_grants"}
}
func workerFor(r Repository, c Client) *Worker {
	return NewWorker(r, c, slog.New(slog.NewTextHandler(io.Discard, nil)))
}
func TestChatDeliveryCanonicalReasonsAndRecovery(t *testing.T) {
	for _, reason := range []string{"eligibility_denied", "member_removed"} {
		r := &fakeRepository{claim: goodClaim()}
		r.claim.Event.SourceReason = reason
		r.claim.Attempt = 2
		c := &fakeClient{result: goodReceipt(r.claim)}
		if err := workerFor(r, c).Step(context.Background()); err != nil {
			t.Fatal(err)
		}
		if c.lookup != 1 || c.apply != 1 || r.completed != 1 || r.retry != 0 {
			t.Fatal("event lookup bypassed canonical replay")
		}
	}
}
func TestChatDeliveryMissingOrTransientReceipt(t *testing.T) {
	for _, err := range []error{ErrNotFound, ErrUnavailable} {
		r := &fakeRepository{claim: goodClaim()}
		r.claim.Attempt = 2
		c := &fakeClient{lookupErr: err, result: goodReceipt(r.claim)}
		result := workerFor(r, c).Step(context.Background())
		if err == ErrNotFound {
			if result != nil || c.apply != 1 || r.completed != 1 {
				t.Fatal("missing receipt replay failed")
			}
		} else if !errors.Is(result, ErrUnavailable) || c.apply != 0 || r.retry != 2 || r.completed != 0 {
			t.Fatal("transient lookup changed delivery")
		}
	}
}
func TestChatDeliveryPermanentQuarantineAndStaleCAS(t *testing.T) {
	for _, reason := range []string{"canonical_conflict", "source_row_invalid"} {
		r := &fakeRepository{claim: goodClaim()}
		c := &fakeClient{applyErr: ErrConflict}
		if reason == "source_row_invalid" {
			r.claim.Event.SourceReason = "unsupported"
		}
		if err := workerFor(r, c).Step(context.Background()); err != nil {
			t.Fatal(err)
		}
		if r.reason != reason || r.retry != 0 || r.completed != 0 {
			t.Fatal("permanent invalid source not quarantined")
		}
		if reason == "source_row_invalid" && c.apply+c.lookup != 0 {
			t.Fatal("invalid source sent")
		}
		r.casErr = ErrStaleClaim
		if !errors.Is(workerFor(r, c).Step(context.Background()), ErrStaleClaim) {
			t.Fatal("stale worker quarantined new owner")
		}
	}
}
func TestChatDeliveryInvalidOrChangedOperationStaysPending(t *testing.T) {
	r := &fakeRepository{claim: goodClaim()}
	r.claim.Attempt = 2
	found := goodReceipt(r.claim)
	changed := found
	changed.OperationID = uuid.New()
	c := &fakeClient{result: changed, found: &found}
	if err := workerFor(r, c).Step(context.Background()); !errors.Is(err, ErrUnavailable) || r.completed != 0 || r.retry != 2 {
		t.Fatal("different operation accepted")
	}
	for _, effect := range []string{"media_complete", "media_pending"} {
		r := &fakeRepository{claim: goodClaim()}
		invalid := goodReceipt(r.claim)
		invalid.Effect = effect
		if err := workerFor(r, &fakeClient{result: invalid}).Step(context.Background()); !errors.Is(err, ErrUnavailable) || r.completed != 0 {
			t.Fatal("nonfactual media receipt accepted")
		}
	}
}
func TestChatDeliveryDeadlineAndCounterMath(t *testing.T) {
	r := &fakeRepository{claim: goodClaim()}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := workerFor(r, &fakeClient{block: true}).Step(ctx); !errors.Is(err, context.DeadlineExceeded) || r.retry != 0 || r.completed != 0 || r.reason != "" {
		t.Fatal("canceled attempt lost claim")
	}
	if !errors.Is(workerFor(&fakeRepository{exhausted: true}, &fakeClient{}).Step(context.Background()), ErrExhausted) {
		t.Fatal("counter exhaustion hidden")
	}
	if RetrySeconds(math.MaxInt64) != 30 || RetrySeconds(1) != 1 || RetrySeconds(2) != 2 {
		t.Fatal("retry arithmetic overflow")
	}
}
