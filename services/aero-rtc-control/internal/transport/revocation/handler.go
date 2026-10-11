package revocation

import (
	"context"
	"crypto/tls"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"time"

	"connectrpc.com/connect"
	rpc "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/revocation/v1"
	"github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/revocation/v1/rtcrevocationv1connect"
	domain "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/revocation"
	"github.com/google/uuid"
)

const IdentityCallerURI = "urn:aerochat:service:identity"
const ChatCallerURI = "urn:aerochat:service:chat"
const RequestTimeout = 5 * time.Second

type Service interface {
	ApplyIdentityEvent(context.Context, domain.IdentityEvent) (domain.Receipt, error)
	ApplyChatEvent(context.Context, domain.ChatEvent) (domain.Receipt, error)
	GetIdentityEventReceipt(context.Context, string) (domain.Receipt, error)
	GetChatEventReceipt(context.Context, string) (domain.Receipt, error)
}
type callerPrincipal struct{}
type handler struct{ service Service }

func VerifiedPrincipal(state tls.ConnectionState) (string, error) {
	if len(state.VerifiedChains) == 0 || len(state.PeerCertificates) == 0 {
		return "", errors.New("private caller denied")
	}
	uris := state.PeerCertificates[0].URIs
	if len(uris) != 1 {
		return "", errors.New("private caller denied")
	}
	principal := uris[0].String()
	if principal != IdentityCallerURI && principal != ChatCallerURI {
		return "", errors.New("private caller denied")
	}
	return principal, nil
}
func VerifyCaller(state tls.ConnectionState) error { _, err := VerifiedPrincipal(state); return err }
func expectedCaller(path string) string {
	switch path {
	case rtcrevocationv1connect.SourceRevocationServiceApplyIdentityEventProcedure, rtcrevocationv1connect.SourceRevocationServiceGetIdentityEventReceiptProcedure:
		return IdentityCallerURI
	case rtcrevocationv1connect.SourceRevocationServiceApplyChatEventProcedure, rtcrevocationv1connect.SourceRevocationServiceGetChatEventReceiptProcedure:
		return ChatCallerURI
	default:
		return ""
	}
}

func NewHTTPHandler(logger *slog.Logger, service Service) http.Handler {
	mux := http.NewServeMux()
	path, rpcs := rtcrevocationv1connect.NewSourceRevocationServiceHandler(&handler{service: service}, connect.WithReadMaxBytes(4096), connect.WithSendMaxBytes(4096))
	mux.Handle(path, rpcs)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.TLS == nil {
			http.Error(w, "private caller denied", http.StatusForbidden)
			return
		}
		principal, err := VerifiedPrincipal(*r.TLS)
		expected := expectedCaller(r.URL.Path)
		if err != nil || expected == "" || principal != expected {
			http.Error(w, "private caller denied", http.StatusForbidden)
			return
		}
		ctx, cancel := context.WithTimeout(context.WithValue(r.Context(), callerPrincipal{}, principal), RequestTimeout)
		defer cancel()
		started := time.Now()
		status := &responseStatus{ResponseWriter: w}
		mux.ServeHTTP(status, r.WithContext(ctx))
		logger.Debug("private source receipt request", slog.String("method", r.URL.Path), slog.Int("status", status.status), slog.Duration("duration", time.Since(started)))
	})
}

type responseStatus struct {
	http.ResponseWriter
	status int
}

func (w *responseStatus) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
	w.ResponseWriter.WriteHeader(status)
}
func (w *responseStatus) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(p)
}
func (w *responseStatus) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (h *handler) check(ctx context.Context, expected string) error {
	if ctx.Value(callerPrincipal{}) != expected {
		return connect.NewError(connect.CodePermissionDenied, errors.New("private caller denied"))
	}
	if h.service == nil {
		return mapError(domain.ErrUnavailable)
	}
	return nil
}

func (h *handler) ApplyIdentityEvent(ctx context.Context, req *connect.Request[rpc.ApplyIdentityEventRequest]) (*connect.Response[rpc.ApplyIdentityEventResponse], error) {
	if err := h.check(ctx, IdentityCallerURI); err != nil {
		return nil, err
	}
	kind := ""
	switch req.Msg.Kind {
	case rpc.IdentityEventKind_IDENTITY_EVENT_KIND_SESSION:
		kind = "session"
	case rpc.IdentityEventKind_IDENTITY_EVENT_KIND_DEVICE:
		kind = "device"
	default:
		return nil, mapError(domain.ErrInvalidArgument)
	}
	result, err := h.service.ApplyIdentityEvent(ctx, domain.IdentityEvent{EventID: req.Msg.EventId, Kind: kind, SubjectID: req.Msg.SubjectId, UserID: req.Msg.UserId, DeviceID: req.Msg.DeviceId, Revision: req.Msg.SourceRevision})
	if err != nil {
		return nil, mapError(err)
	}
	receipt, err := toProto(result, "identity")
	if err != nil {
		return nil, mapError(err)
	}
	return connect.NewResponse(&rpc.ApplyIdentityEventResponse{Receipt: receipt}), nil
}
func (h *handler) ApplyChatEvent(ctx context.Context, req *connect.Request[rpc.ApplyChatEventRequest]) (*connect.Response[rpc.ApplyChatEventResponse], error) {
	if err := h.check(ctx, ChatCallerURI); err != nil {
		return nil, err
	}
	result, err := h.service.ApplyChatEvent(ctx, domain.ChatEvent{EventID: req.Msg.EventId, GroupID: req.Msg.GroupId, UserID: req.Msg.UserId, Revision: req.Msg.EligibilityEpoch})
	if err != nil {
		return nil, mapError(err)
	}
	receipt, err := toProto(result, "chat")
	if err != nil {
		return nil, mapError(err)
	}
	return connect.NewResponse(&rpc.ApplyChatEventResponse{Receipt: receipt}), nil
}
func (h *handler) GetIdentityEventReceipt(ctx context.Context, req *connect.Request[rpc.GetIdentityEventReceiptRequest]) (*connect.Response[rpc.GetIdentityEventReceiptResponse], error) {
	if err := h.check(ctx, IdentityCallerURI); err != nil {
		return nil, err
	}
	result, err := h.service.GetIdentityEventReceipt(ctx, req.Msg.EventId)
	if err != nil {
		return nil, mapError(err)
	}
	receipt, err := toProto(result, "identity")
	if err != nil {
		return nil, mapError(err)
	}
	return connect.NewResponse(&rpc.GetIdentityEventReceiptResponse{Receipt: receipt}), nil
}
func (h *handler) GetChatEventReceipt(ctx context.Context, req *connect.Request[rpc.GetChatEventReceiptRequest]) (*connect.Response[rpc.GetChatEventReceiptResponse], error) {
	if err := h.check(ctx, ChatCallerURI); err != nil {
		return nil, err
	}
	result, err := h.service.GetChatEventReceipt(ctx, req.Msg.EventId)
	if err != nil {
		return nil, mapError(err)
	}
	receipt, err := toProto(result, "chat")
	if err != nil {
		return nil, mapError(err)
	}
	return connect.NewResponse(&rpc.GetChatEventReceiptResponse{Receipt: receipt}), nil
}

func toProto(r domain.Receipt, expectedDomain string) (*rpc.SourceEventReceipt, error) {
	if r.EventID == uuid.Nil || r.OperationID == uuid.Nil || r.AffectedRegistryGrants < 0 || r.AffectedRegistryGrants > math.MaxUint32 {
		return nil, domain.ErrUnavailable
	}
	if r.Domain != expectedDomain {
		return nil, domain.ErrUnavailable
	}
	result := &rpc.SourceEventReceipt{EventId: r.EventID.String(), OperationId: r.OperationID.String(), SourceReceipt: rpc.SourceReceiptStatus_SOURCE_RECEIPT_STATUS_DURABLY_APPLIED, AffectedRegistryGrants: uint32(r.AffectedRegistryGrants), RegistryMediaEffect: rpc.RegistryMediaEffect_REGISTRY_MEDIA_EFFECT_MEDIA_PENDING}
	if r.AffectedRegistryGrants == 0 {
		result.RegistryMediaEffect = rpc.RegistryMediaEffect_REGISTRY_MEDIA_EFFECT_NO_MATCHING_REGISTRY_GRANTS
	}
	return result, nil
}
func mapError(err error) error {
	switch {
	case errors.Is(err, context.Canceled):
		return connect.NewError(connect.CodeCanceled, errors.New("source request canceled"))
	case errors.Is(err, context.DeadlineExceeded):
		return connect.NewError(connect.CodeDeadlineExceeded, errors.New("source request deadline exceeded"))
	case errors.Is(err, domain.ErrInvalidArgument):
		return connect.NewError(connect.CodeInvalidArgument, errors.New("invalid source event"))
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, errors.New("source receipt not found"))
	case errors.Is(err, domain.ErrConflict):
		return connect.NewError(connect.CodeAlreadyExists, errors.New("source event payload conflict"))
	default:
		return connect.NewError(connect.CodeUnavailable, errors.New("source event receiver unavailable"))
	}
}
