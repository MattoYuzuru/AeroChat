package authorization

import (
	"context"
	"crypto/tls"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"time"

	"connectrpc.com/connect"
	chatauthorizationv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/authorization/v1"
	"github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/authorization/v1/chatauthorizationv1connect"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
)

const CallerURI = "urn:aerochat:service:rtc-control"
const RequestTimeout = 5 * time.Second

type Service interface {
	CheckGroupSubject(context.Context, string, string) (*chat.GroupSubjectAuthority, error)
}
type callerVerified struct{}
type handler struct{ service Service }

func VerifyCaller(state tls.ConnectionState) error {
	if len(state.VerifiedChains) == 0 || len(state.PeerCertificates) == 0 {
		return errors.New("private caller denied")
	}
	uris := state.PeerCertificates[0].URIs
	if len(uris) != 1 || uris[0].String() != CallerURI {
		return errors.New("private caller denied")
	}
	return nil
}

func NewHTTPHandler(logger *slog.Logger, service Service) http.Handler {
	mux := http.NewServeMux()
	path, rpc := chatauthorizationv1connect.NewInternalAuthorizationServiceHandler(&handler{service: service}, connect.WithReadMaxBytes(4096), connect.WithSendMaxBytes(4096))
	mux.Handle(path, rpc)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.TLS == nil || VerifyCaller(*r.TLS) != nil {
			http.Error(w, "private caller denied", http.StatusForbidden)
			return
		}
		if r.URL.Path != chatauthorizationv1connect.InternalAuthorizationServiceCheckGroupSubjectProcedure {
			http.NotFound(w, r)
			return
		}
		ctx, cancel := context.WithTimeout(context.WithValue(r.Context(), callerVerified{}, true), RequestTimeout)
		defer cancel()
		started := time.Now()
		status := &responseStatus{ResponseWriter: w}
		mux.ServeHTTP(status, r.WithContext(ctx))
		logger.Debug("private group authorization request", slog.String("method", r.URL.Path), slog.Int("status", status.status), slog.Duration("duration", time.Since(started)))
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

func (h *handler) CheckGroupSubject(ctx context.Context, req *connect.Request[chatauthorizationv1.CheckGroupSubjectRequest]) (*connect.Response[chatauthorizationv1.CheckGroupSubjectResponse], error) {
	if ctx.Value(callerVerified{}) != true {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("private caller denied"))
	}
	if h.service == nil {
		return nil, mapError(chat.ErrGroupAuthorityUnavailable)
	}
	authority, err := h.service.CheckGroupSubject(ctx, req.Msg.GroupId, req.Msg.UserId)
	if err != nil {
		return nil, mapError(err)
	}
	result, err := toProto(authority)
	if err != nil {
		return nil, mapError(err)
	}
	return connect.NewResponse(&chatauthorizationv1.CheckGroupSubjectResponse{Authority: result}), nil
}

func toProto(a *chat.GroupSubjectAuthority) (*chatauthorizationv1.GroupSubjectAuthority, error) {
	if a == nil {
		return nil, chat.ErrGroupAuthorityUnavailable
	}
	if a.Status == chat.GroupSubjectNotFound {
		return &chatauthorizationv1.GroupSubjectAuthority{Status: chatauthorizationv1.GroupAuthorityStatus_GROUP_AUTHORITY_STATUS_NOT_FOUND}, nil
	}
	if a.GroupID == "" || a.UserID == "" || a.EligibilityEpoch <= 0 {
		return nil, chat.ErrGroupAuthorityUnavailable
	}
	result := &chatauthorizationv1.GroupSubjectAuthority{GroupId: a.GroupID, UserId: a.UserID, EligibilityEpoch: a.EligibilityEpoch}
	switch a.Status {
	case chat.GroupSubjectRemoved:
		if a.Role != "" {
			return nil, chat.ErrGroupAuthorityUnavailable
		}
		result.Status = chatauthorizationv1.GroupAuthorityStatus_GROUP_AUTHORITY_STATUS_REMOVED
	case chat.GroupSubjectPresent:
		result.Status = chatauthorizationv1.GroupAuthorityStatus_GROUP_AUTHORITY_STATUS_PRESENT
		switch a.Role {
		case chat.GroupMemberRoleOwner:
			result.Role = chatauthorizationv1.GroupAuthorityRole_GROUP_AUTHORITY_ROLE_OWNER
		case chat.GroupMemberRoleAdmin:
			result.Role = chatauthorizationv1.GroupAuthorityRole_GROUP_AUTHORITY_ROLE_ADMIN
		case chat.GroupMemberRoleMember:
			result.Role = chatauthorizationv1.GroupAuthorityRole_GROUP_AUTHORITY_ROLE_MEMBER
		case chat.GroupMemberRoleReader:
			result.Role = chatauthorizationv1.GroupAuthorityRole_GROUP_AUTHORITY_ROLE_READER
		default:
			return nil, chat.ErrGroupAuthorityUnavailable
		}
		if a.Role != chat.GroupMemberRoleReader && a.EligibilityEpoch == math.MaxInt64 {
			return nil, chat.ErrGroupAuthorityUnavailable
		}
	default:
		return nil, chat.ErrGroupAuthorityUnavailable
	}
	return result, nil
}

func mapError(err error) error {
	switch {
	case errors.Is(err, context.Canceled):
		return connect.NewError(connect.CodeCanceled, errors.New("authorization canceled"))
	case errors.Is(err, context.DeadlineExceeded):
		return connect.NewError(connect.CodeDeadlineExceeded, errors.New("authorization deadline exceeded"))
	case errors.Is(err, chat.ErrInvalidArgument):
		return connect.NewError(connect.CodeInvalidArgument, errors.New("invalid group binding"))
	default:
		return connect.NewError(connect.CodeUnavailable, errors.New("group authority unavailable"))
	}
}
