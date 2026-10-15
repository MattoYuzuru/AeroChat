package admission

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
)

type fakeRegistrationRepository struct {
	result *Instance
	err    error
	calls  int
	leaf   [32]byte
}

func (r *fakeRegistrationRepository) Register(_ context.Context, leaf [32]byte, _ uuid.UUID) (*Instance, error) {
	r.calls++
	r.leaf = leaf
	return r.result, r.err
}
func TestRegistrationRequiresVerifiedContextAndCanonicalNonce(t *testing.T) {
	request := uuid.New()
	leaf := [32]byte{7}
	repo := &fakeRegistrationRepository{result: &Instance{ID: uuid.New(), RequestID: request, Fence: 1, State: "active"}}
	service := NewService(repo)
	if _, err := service.RegisterInstance(context.Background(), request.String()); !errors.Is(err, ErrDenied) || repo.calls != 0 {
		t.Fatal("unverified context allocated")
	}
	ctx := WithVerifiedLeaf(context.Background(), leaf)
	for _, bad := range []string{"", uuid.Nil.String(), " " + request.String(), strings.ToUpper(request.String()), strings.ReplaceAll(request.String(), "-", "")} {
		if _, err := service.RegisterInstance(ctx, bad); !errors.Is(err, ErrInvalidArgument) {
			t.Fatal("noncanonical request accepted")
		}
	}
	result, err := service.RegisterInstance(ctx, request.String())
	if err != nil || result.Fence != 1 || repo.leaf != leaf {
		t.Fatal("verified leaf context lost")
	}
}
func TestRegistrationRejectsUnsupportedRepositoryFacts(t *testing.T) {
	request := uuid.New()
	ctx := WithVerifiedLeaf(context.Background(), [32]byte{8})
	for _, bad := range []*Instance{nil, {ID: uuid.Nil, RequestID: request, Fence: 1, State: "active"}, {ID: uuid.New(), RequestID: uuid.New(), Fence: 1, State: "active"}, {ID: uuid.New(), RequestID: request, Fence: 0, State: "active"}, {ID: uuid.New(), RequestID: request, Fence: 1, State: "unknown"}} {
		if _, err := NewService(&fakeRegistrationRepository{result: bad}).RegisterInstance(ctx, request.String()); !errors.Is(err, ErrUnavailable) {
			t.Fatal("unsupported registration exposed")
		}
	}
	for _, state := range []string{"active", "draining", "retired"} {
		result := &Instance{ID: uuid.New(), RequestID: request, Fence: 1, State: state}
		if got, err := NewService(&fakeRegistrationRepository{result: result}).RegisterInstance(ctx, request.String()); err != nil || got.State != state {
			t.Fatal("inactive retry reactivated")
		}
	}
}
