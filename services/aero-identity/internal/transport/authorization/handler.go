package authorization

import (
	"context"
	"crypto/tls"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	identityauthorizationv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/authorization/v1"
	"github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/authorization/v1/identityauthorizationv1connect"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/domain/identity"
)

const CallerURI = "urn:aerochat:service:rtc-control"
const RequestTimeout = 5 * time.Second

type Service interface {
	ResolveSessionBearer(context.Context, string) (*identity.SessionAuthority, error)
	CheckBoundSession(context.Context, string, string, string) (*identity.SessionAuthority, error)
}

type verifiedCallerKey struct{}

type handler struct{ service Service }

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

// VerifyCaller проверяет principal дополнительно к стандартной verified mTLS chain.
func VerifyCaller(state tls.ConnectionState) error {
	if len(state.VerifiedChains) == 0 || len(state.PeerCertificates) == 0 {
		return errors.New("private caller denied")
	}
	principal := state.PeerCertificates[0].URIs
	if len(principal) != 1 || principal[0].String() != CallerURI {
		return errors.New("private caller denied")
	}
	return nil
}

func NewHTTPHandler(logger *slog.Logger, service Service) http.Handler {
	mux := http.NewServeMux()
	path, rpc := identityauthorizationv1connect.NewInternalAuthorizationServiceHandler(&handler{service}, connect.WithReadMaxBytes(4096), connect.WithSendMaxBytes(4096))
	mux.Handle(path, rpc)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.TLS == nil || VerifyCaller(*r.TLS) != nil {
			http.Error(w, "private caller denied", http.StatusForbidden)
			return
		}
		switch r.URL.Path {
		case identityauthorizationv1connect.InternalAuthorizationServiceResolveSessionBearerProcedure, identityauthorizationv1connect.InternalAuthorizationServiceCheckBoundSessionProcedure:
		default:
			http.NotFound(w, r)
			return
		}
		ctx, cancel := context.WithTimeout(context.WithValue(r.Context(), verifiedCallerKey{}, true), RequestTimeout)
		defer cancel()
		started := time.Now()
		status := &responseStatus{ResponseWriter: w}
		mux.ServeHTTP(status, r.WithContext(ctx))
		logger.Debug("private authorization request", slog.String("method", r.URL.Path), slog.Int("status", status.status), slog.Duration("duration", time.Since(started)))
	})
}

func (h *handler) ResolveSessionBearer(ctx context.Context, req *connect.Request[identityauthorizationv1.ResolveSessionBearerRequest]) (*connect.Response[identityauthorizationv1.ResolveSessionBearerResponse], error) {
	if ctx.Value(verifiedCallerKey{}) != true {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("private caller denied"))
	}
	const prefix = "Bearer "
	header := req.Header().Get("Authorization")
	if !strings.HasPrefix(header, prefix) || strings.TrimSpace(strings.TrimPrefix(header, prefix)) == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("session bearer required"))
	}
	authority, err := h.service.ResolveSessionBearer(ctx, strings.TrimSpace(strings.TrimPrefix(header, prefix)))
	if err != nil {
		return nil, mapError(err)
	}
	result, err := toProto(authority)
	if err != nil {
		return nil, mapError(err)
	}
	return connect.NewResponse(&identityauthorizationv1.ResolveSessionBearerResponse{Authority: result}), nil
}

func (h *handler) CheckBoundSession(ctx context.Context, req *connect.Request[identityauthorizationv1.CheckBoundSessionRequest]) (*connect.Response[identityauthorizationv1.CheckBoundSessionResponse], error) {
	if ctx.Value(verifiedCallerKey{}) != true {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("private caller denied"))
	}
	authority, err := h.service.CheckBoundSession(ctx, req.Msg.UserId, req.Msg.SessionId, req.Msg.DeviceId)
	if err != nil {
		return nil, mapError(err)
	}
	result, err := toProto(authority)
	if err != nil {
		return nil, mapError(err)
	}
	return connect.NewResponse(&identityauthorizationv1.CheckBoundSessionResponse{Authority: result}), nil
}

func toProto(authority *identity.SessionAuthority) (*identityauthorizationv1.SessionAuthority, error) {
	if authority == nil {
		return nil, identity.ErrAuthorityUnavailable
	}
	status := identityauthorizationv1.AuthorityStatus_AUTHORITY_STATUS_UNSPECIFIED
	switch authority.Status {
	case identity.AuthorityActive:
		status = identityauthorizationv1.AuthorityStatus_AUTHORITY_STATUS_ACTIVE
	case identity.AuthorityRevoked:
		status = identityauthorizationv1.AuthorityStatus_AUTHORITY_STATUS_REVOKED
	case identity.AuthorityNotFound:
		return &identityauthorizationv1.SessionAuthority{Status: identityauthorizationv1.AuthorityStatus_AUTHORITY_STATUS_NOT_FOUND}, nil
	default:
		return nil, identity.ErrAuthorityUnavailable
	}
	if authority.UserID == "" || authority.SessionID == "" || authority.DeviceID == "" || authority.SessionRevision < 1 || authority.DeviceRevision < 1 {
		return nil, identity.ErrAuthorityUnavailable
	}
	return &identityauthorizationv1.SessionAuthority{UserId: authority.UserID, SessionId: authority.SessionID, DeviceId: authority.DeviceID, SessionAuthorityRevision: authority.SessionRevision, DeviceAuthorityRevision: authority.DeviceRevision, Status: status}, nil
}

func mapError(err error) error {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return connect.NewError(connect.CodeDeadlineExceeded, errors.New("authorization deadline exceeded"))
	case errors.Is(err, context.Canceled):
		return connect.NewError(connect.CodeCanceled, errors.New("authorization canceled"))
	case errors.Is(err, identity.ErrUnauthorized):
		return connect.NewError(connect.CodeUnauthenticated, errors.New("session bearer denied"))
	case errors.Is(err, identity.ErrInvalidArgument):
		return connect.NewError(connect.CodeInvalidArgument, errors.New("invalid session binding"))
	default:
		return connect.NewError(connect.CodeUnavailable, errors.New("session authority unavailable"))
	}
}
