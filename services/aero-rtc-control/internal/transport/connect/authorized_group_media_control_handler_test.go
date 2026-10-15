package connecthandler

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	rpc "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1"
	control "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediacontrol"
	"github.com/google/uuid"
)

func TestFreshControlHeaderAliasesAndAmbiguity(t *testing.T) {
	for _, header := range []http.Header{{}, {"Authorization": nil}, {"Authorization": []string{}}, {"Authorization": []string{""}}, {"Authorization": []string{"Bearer unit", "Bearer unit"}}, {"Authorization": []string{"Bearer unit"}, "authorization": []string{"Bearer other"}}, {"AUTHORIZATION": []string{"Bearer unit,other"}}, {"Authorization": []string{"Bearer unit\nsecret"}}, {"Authorization": []string{"Basic unit"}}, {"Authorization": []string{"Bearer  unit"}}} {
		if _, err := strictControlBearer(header); !errors.Is(err, control.ErrUnauthenticated) {
			t.Fatal("ambiguous credential принят")
		}
	}
	if token, err := strictControlBearer(http.Header{"aUtHoRiZaTiOn": []string{"Bearer unit"}}); err != nil || token != "unit" {
		t.Fatal("single selector потерян", err)
	}
}
func TestFreshControlPublicMapperNeverReportsModelComplete(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	for _, resolution := range []string{"known", "unknown"} {
		i := control.Intent{ID: uuid.New(), CallID: uuid.New(), Kind: "leave", State: "complete", Resolution: resolution, CreatedAt: time.Now()}
		op, err := publicControlOperation(ctx, i)
		if err != nil {
			t.Fatal(err)
		}
		if op.MediaOutcome != rpc.MediaControlOutcome_MEDIA_CONTROL_OUTCOME_PENDING || op.PendingReason != "provider_unverified" {
			t.Fatal("model ACK стал provider COMPLETE")
		}
	}
	cancel()
	if _, err := publicControlOperation(ctx, control.Intent{}); connect.CodeOf(err) != connect.CodeCanceled {
		t.Fatal("late receipt после cancel", err)
	}
}
func TestFreshControlServerContractIsExplicit(t *testing.T) {
	if controlServerContract(context.Background()) {
		t.Fatal("missing server context принят")
	}
	server := &http.Server{ReadHeaderTimeout: time.Second, ReadTimeout: time.Second, WriteTimeout: time.Second, MaxHeaderBytes: 8192}
	ctx := context.WithValue(context.Background(), http.ServerContextKey, server)
	if !controlServerContract(ctx) {
		t.Fatal("valid owned server caps отклонены")
	}
	server.ReadTimeout = 0
	if controlServerContract(ctx) {
		t.Fatal("неограниченный cleanup принят")
	}
}

type aliasDeniedAuthority struct{ calls int }

func (a *aliasDeniedAuthority) Resolve(context.Context, string) (control.OwnStatusSubject, error) {
	a.calls++
	return control.OwnStatusSubject{}, control.ErrUnavailable
}
func (a *aliasDeniedAuthority) CheckBound(context.Context, control.OwnStatusSubject) (control.OwnStatusSubject, error) {
	a.calls++
	return control.OwnStatusSubject{}, control.ErrUnavailable
}
func (a *aliasDeniedAuthority) CheckGroup(context.Context, uuid.UUID, uuid.UUID) (control.GroupFacts, error) {
	a.calls++
	return control.GroupFacts{}, control.ErrUnavailable
}

type aliasDeniedStore struct{}

func (aliasDeniedStore) ReadOwnLeave(context.Context, uuid.UUID, control.OwnStatusSubject) (control.Intent, error) {
	return control.Intent{}, control.ErrUnavailable
}
func (aliasDeniedStore) ReadOwnRequest(context.Context, uuid.UUID, control.OwnStatusSubject) (control.Intent, error) {
	return control.Intent{}, control.ErrUnavailable
}
func (aliasDeniedStore) ReadControlScope(context.Context, uuid.UUID, control.OwnStatusSubject) (control.ControlScope, error) {
	return control.ControlScope{}, control.ErrUnavailable
}
func (aliasDeniedStore) ReadEndScope(context.Context, uuid.UUID, control.OwnStatusSubject) (control.Intent, control.ControlScope, error) {
	return control.Intent{}, control.ControlScope{}, control.ErrUnavailable
}
func (aliasDeniedStore) RequestAuthorized(context.Context, control.Request, func(context.Context) error) (control.Intent, error) {
	return control.Intent{}, control.ErrUnavailable
}

type aliasDeadlineRecorder struct{ *httptest.ResponseRecorder }

func (aliasDeadlineRecorder) SetReadDeadline(time.Time) error  { return nil }
func (aliasDeadlineRecorder) SetWriteDeadline(time.Time) error { return nil }

type aliasCountedBody struct {
	io.Reader
	reads int
}

func (r *aliasCountedBody) Read(p []byte) (int, error) { r.reads++; return r.Reader.Read(p) }
func (*aliasCountedBody) Close() error                 { return nil }
func TestFreshControlEmptyAliasDeniedBeforeDecodeAndSources(t *testing.T) {
	for _, empty := range [][]string{nil, {}} {
		header := http.Header{"Authorization": []string{"Bearer unit"}, "authorization": empty}
		if _, err := strictControlBearer(header); !errors.Is(err, control.ErrUnauthenticated) {
			t.Fatal("empty alias key принят")
		}
		authority := &aliasDeniedAuthority{}
		service, err := control.NewAuthorizedService(aliasDeniedStore{}, authority)
		if err != nil {
			t.Fatal(err)
		}
		handler, err := NewAuthorizedGroupMediaControlHTTPHandler(service)
		if err != nil {
			t.Fatal(err)
		}
		body := &aliasCountedBody{Reader: strings.NewReader(`{"callId":"` + uuid.NewString() + `","requestId":"` + uuid.NewString() + `"}`)}
		request := httptest.NewRequest(http.MethodPost, "/aerochat.rtc.v1.GroupMediaControlService/RequestGroupMediaLeave", body)
		request.Header = header
		request.Header.Set("Content-Type", "application/json")
		server := &http.Server{ReadHeaderTimeout: time.Second, ReadTimeout: time.Second, WriteTimeout: time.Second, MaxHeaderBytes: 8192}
		request = request.WithContext(context.WithValue(request.Context(), http.ServerContextKey, server))
		recorder := aliasDeadlineRecorder{httptest.NewRecorder()}
		handler.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusUnauthorized || authority.calls != 0 || body.reads != 0 {
			t.Fatal("alias дошёл до decode/private sources")
		}
	}
}
