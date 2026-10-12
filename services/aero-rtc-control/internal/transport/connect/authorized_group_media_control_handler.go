package connecthandler

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	rpc "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1"
	rc "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1/rtcv1connect"
	control "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediacontrol"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Этот selector хранит transient credential, не AuthContext/verified authority.
type controlCredentialKey struct{}
type authorizedGroupMediaHandler struct{ service *control.AuthorizedService }

func strictControlBearer(header http.Header) (string, error) {
	var values []string
	keys := 0
	for key, items := range header {
		if strings.EqualFold(key, "Authorization") {
			keys++
			values = append(values, items...)
		}
	}
	if keys != 1 || len(values) != 1 {
		return "", control.ErrUnauthenticated
	}
	value := values[0]
	for _, b := range []byte(value) {
		if b < 32 || b == 127 || b == ',' {
			return "", control.ErrUnauthenticated
		}
	}
	const prefix = "Bearer "
	if !strings.HasPrefix(value, prefix) {
		return "", control.ErrUnauthenticated
	}
	token := strings.TrimPrefix(value, prefix)
	if token == "" || strings.ContainsAny(token, " \t\r\n") {
		return "", control.ErrUnauthenticated
	}
	return token, nil
}
func controlServerContract(ctx context.Context) bool {
	s, ok := ctx.Value(http.ServerContextKey).(*http.Server)
	return ok && s != nil && s.ReadHeaderTimeout > 0 && s.ReadHeaderTimeout <= control.RequestBudget && s.ReadTimeout > 0 && s.ReadTimeout <= control.RequestBudget && s.WriteTimeout > 0 && s.WriteTimeout <= control.RequestBudget && s.MaxHeaderBytes == 8192
}
func denyControlHTTP(w http.ResponseWriter, r *http.Request, status int) {
	// Не закрываем/drain body вручную: net/http cleanup ограничен D/server fallback.
	if r.ProtoMajor == 1 {
		r.Close = true
		w.Header().Set("Connection", "close")
	}
	_ = http.NewResponseController(w).SetReadDeadline(time.Now())
	http.Error(w, "media control transport denied", status)
}

// Factory не монтируется app/main/gateway; server contract обязателен отдельно.
func NewAuthorizedGroupMediaControlHTTPHandler(service *control.AuthorizedService) (http.Handler, error) {
	if service == nil {
		return nil, control.ErrUnavailable
	}
	_, handler := rc.NewGroupMediaControlServiceHandler(&authorizedGroupMediaHandler{service: service}, connect.WithReadMaxBytes(4096), connect.WithSendMaxBytes(4096))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), control.RequestBudget)
		defer cancel()
		r = r.WithContext(ctx)
		if !controlServerContract(ctx) {
			denyControlHTTP(w, r, http.StatusServiceUnavailable)
			return
		}
		d, _ := ctx.Deadline()
		controller := http.NewResponseController(w)
		if controller.SetReadDeadline(d) != nil || controller.SetWriteDeadline(d) != nil || ctx.Err() != nil {
			denyControlHTTP(w, r, http.StatusServiceUnavailable)
			return
		}
		bearer, err := strictControlBearer(r.Header)
		if err != nil {
			denyControlHTTP(w, r, http.StatusUnauthorized)
			return
		}
		if r.Body == nil {
			r.Body = http.NoBody
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4096))
		if err != nil || ctx.Err() != nil || !time.Now().Before(d) {
			denyControlHTTP(w, r, http.StatusBadRequest)
			return
		}
		// EOF уже получен под deadline; Connect декодирует только эти bounded bytes.
		r.Body = io.NopCloser(bytes.NewReader(body))
		r = r.WithContext(context.WithValue(ctx, controlCredentialKey{}, bearer))
		handler.ServeHTTP(w, r)
		if ctx.Err() == nil && time.Now().Before(d) {
			if controller.SetReadDeadline(time.Time{}) != nil {
				if r.ProtoMajor == 1 {
					r.Close = true
				}
			}
		} else if r.ProtoMajor == 1 {
			r.Close = true
		}
		// Write deadline остаётся до net/http finish/flush; delivery за D не обещается.
	}), nil
}
func controlCredential(ctx context.Context) (string, error) {
	value, ok := ctx.Value(controlCredentialKey{}).(string)
	if !ok || value == "" {
		return "", control.ErrUnauthenticated
	}
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	return value, nil
}
func controlBodyID(raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil || id == uuid.Nil || raw != id.String() {
		return uuid.Nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid media control id"))
	}
	return id, nil
}
func mapControlError(err error) error {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return connect.NewError(connect.CodeDeadlineExceeded, errors.New("media control deadline exceeded"))
	case errors.Is(err, context.Canceled):
		return connect.NewError(connect.CodeCanceled, errors.New("media control canceled"))
	case errors.Is(err, control.ErrUnauthenticated):
		return connect.NewError(connect.CodeUnauthenticated, errors.New("media control credential denied"))
	case errors.Is(err, control.ErrDenied), errors.Is(err, control.ErrNotFound):
		return connect.NewError(connect.CodePermissionDenied, errors.New("media control denied"))
	case errors.Is(err, control.ErrConflict):
		return connect.NewError(connect.CodeAlreadyExists, errors.New("media control request conflict"))
	default:
		return connect.NewError(connect.CodeUnavailable, errors.New("media control unavailable"))
	}
}
func publicControlOperation(ctx context.Context, i control.Intent) (*rpc.GroupMediaOperation, error) {
	if ctx.Err() != nil {
		return nil, mapControlError(ctx.Err())
	}
	kind := rpc.MediaControlKind_MEDIA_CONTROL_KIND_UNSPECIFIED
	switch i.Kind {
	case "leave":
		kind = rpc.MediaControlKind_MEDIA_CONTROL_KIND_LEAVE
	case "end":
		kind = rpc.MediaControlKind_MEDIA_CONTROL_KIND_END
	}
	created := timestamppb.New(i.CreatedAt)
	if i.ID == uuid.Nil || i.CallID == uuid.Nil || kind == rpc.MediaControlKind_MEDIA_CONTROL_KIND_UNSPECIFIED || i.CreatedAt.IsZero() || created.CheckValid() != nil {
		return nil, mapControlError(control.ErrUnavailable)
	}
	// Model journal complete не является trusted provider proof.
	return &rpc.GroupMediaOperation{OperationId: i.ID.String(), CallId: i.CallID.String(), Kind: kind, MediaOutcome: rpc.MediaControlOutcome_MEDIA_CONTROL_OUTCOME_PENDING, PendingReason: "provider_unverified", CreatedAt: created}, nil
}
func (h *authorizedGroupMediaHandler) RequestGroupMediaLeave(ctx context.Context, req *connect.Request[rpc.RequestGroupMediaLeaveRequest]) (*connect.Response[rpc.RequestGroupMediaLeaveResponse], error) {
	if req == nil || req.Msg == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid media control request"))
	}
	token, err := controlCredential(ctx)
	if err != nil {
		return nil, mapControlError(err)
	}
	call, err := controlBodyID(req.Msg.CallId)
	if err != nil {
		return nil, err
	}
	request, err := controlBodyID(req.Msg.RequestId)
	if err != nil {
		return nil, err
	}
	i, err := h.service.RequestLeave(ctx, token, call, request)
	if err != nil {
		return nil, mapControlError(err)
	}
	op, err := publicControlOperation(ctx, i)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&rpc.RequestGroupMediaLeaveResponse{Operation: op}), nil
}
func (h *authorizedGroupMediaHandler) RequestGroupMediaEnd(ctx context.Context, req *connect.Request[rpc.RequestGroupMediaEndRequest]) (*connect.Response[rpc.RequestGroupMediaEndResponse], error) {
	if req == nil || req.Msg == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid media control request"))
	}
	token, err := controlCredential(ctx)
	if err != nil {
		return nil, mapControlError(err)
	}
	call, err := controlBodyID(req.Msg.CallId)
	if err != nil {
		return nil, err
	}
	request, err := controlBodyID(req.Msg.RequestId)
	if err != nil {
		return nil, err
	}
	i, err := h.service.RequestEnd(ctx, token, call, request)
	if err != nil {
		return nil, mapControlError(err)
	}
	op, err := publicControlOperation(ctx, i)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&rpc.RequestGroupMediaEndResponse{Operation: op}), nil
}
func (h *authorizedGroupMediaHandler) GetGroupMediaOperation(ctx context.Context, req *connect.Request[rpc.GetGroupMediaOperationRequest]) (*connect.Response[rpc.GetGroupMediaOperationResponse], error) {
	if req == nil || req.Msg == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid media control request"))
	}
	token, err := controlCredential(ctx)
	if err != nil {
		return nil, mapControlError(err)
	}
	id, err := controlBodyID(req.Msg.OperationId)
	if err != nil {
		return nil, err
	}
	i, err := h.service.GetOperation(ctx, token, id)
	if err != nil {
		return nil, mapControlError(err)
	}
	op, err := publicControlOperation(ctx, i)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&rpc.GetGroupMediaOperationResponse{Operation: op}), nil
}
