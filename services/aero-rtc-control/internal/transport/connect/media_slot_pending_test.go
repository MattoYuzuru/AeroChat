package connecthandler

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/rtc"
)

func TestMediaSlotPendingAndUnavailableStaticTransportErrors(t *testing.T) {
	for _, tc := range []struct {
		err  error
		code connect.Code
	}{{rtc.ErrMediaCleanupPending, connect.CodeFailedPrecondition}, {rtc.ErrUnavailable, connect.CodeUnavailable}} {
		mapped := mapError(fmt.Errorf("private fixture marker: %w", tc.err))
		var typed *connect.Error
		if !errors.As(mapped, &typed) || typed.Code() != tc.code || strings.Contains(mapped.Error(), "private fixture marker") || typed.Message() != tc.err.Error() {
			t.Fatalf("mapped=%v", mapped)
		}
	}
}
