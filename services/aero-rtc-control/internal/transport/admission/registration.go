package admission

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"connectrpc.com/connect"
	rtcadmissionv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/admission/v1"
	"github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/admission/v1/rtcadmissionv1connect"
	domain "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/admission"
	"github.com/google/uuid"
)

const CallerURI = "urn:aerochat:service:media-admission"
const requestBudget = 5 * time.Second

type Service interface {
	RegisterInstance(context.Context, string) (*domain.Instance, error)
}
type handler struct{ service Service }

func VerifiedFingerprint(c tls.ConnectionState) ([32]byte, error) {
	denied := errors.New("registration TLS caller denied")
	if c.Version < tls.VersionTLS13 || len(c.PeerCertificates) == 0 || len(c.VerifiedChains) == 0 {
		return [32]byte{}, denied
	}
	leaf := c.PeerCertificates[0]
	if leaf == nil || leaf.IsCA || len(leaf.URIs) != 1 || leaf.URIs[0].String() != CallerURI || time.Now().Before(leaf.NotBefore) || !time.Now().Before(leaf.NotAfter) {
		return [32]byte{}, denied
	}
	clientUsage := false
	for _, usage := range leaf.ExtKeyUsage {
		if usage == x509.ExtKeyUsageClientAuth {
			clientUsage = true
		}
	}
	if !clientUsage {
		return [32]byte{}, denied
	}
	matching := false
	for _, chain := range c.VerifiedChains {
		if len(chain) > 0 && chain[0] != nil && bytes.Equal(chain[0].Raw, leaf.Raw) {
			matching = true
		}
	}
	if !matching {
		return [32]byte{}, denied
	}
	return sha256.Sum256(leaf.Raw), nil
}
func VerifyCaller(c tls.ConnectionState) error { _, err := VerifiedFingerprint(c); return err }
func NewHTTPHandler(logger *slog.Logger, service Service) http.Handler {
	_, typed := rtcadmissionv1connect.NewAdmissionRegistrationServiceHandler(&handler{service: service}, connect.WithReadMaxBytes(4096), connect.WithSendMaxBytes(4096))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		status := http.StatusForbidden
		defer func() {
			logger.Debug("private registration request", slog.String("method", "RegisterInstance"), slog.Int("status", status), slog.Duration("duration", time.Since(started)))
		}()
		if r.URL.Path != rtcadmissionv1connect.AdmissionRegistrationServiceRegisterInstanceProcedure || r.TLS == nil {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		fingerprint, err := VerifiedFingerprint(*r.TLS)
		if err != nil {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), requestBudget)
		defer cancel()
		ctx = domain.WithVerifiedLeaf(ctx, fingerprint)
		recorder := &registrationStatus{ResponseWriter: w, status: http.StatusOK}
		typed.ServeHTTP(recorder, r.WithContext(ctx))
		status = recorder.status
	})
}

type registrationStatus struct {
	http.ResponseWriter
	status int
}

func (r *registrationStatus) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}
func (h *handler) RegisterInstance(ctx context.Context, request *connect.Request[rtcadmissionv1.RegisterInstanceRequest]) (*connect.Response[rtcadmissionv1.RegisterInstanceResponse], error) {
	if h.service == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("registration unavailable"))
	}
	result, err := h.service.RegisterInstance(ctx, request.Msg.GetRequestId())
	if err != nil {
		return nil, mapError(err)
	}
	parsed, parseErr := uuid.Parse(request.Msg.GetRequestId())
	if parseErr != nil || result == nil || !result.ValidFor(parsed) {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("registration unavailable"))
	}
	state := rtcadmissionv1.AdmissionInstanceState_ADMISSION_INSTANCE_STATE_UNSPECIFIED
	switch result.State {
	case "active":
		state = rtcadmissionv1.AdmissionInstanceState_ADMISSION_INSTANCE_STATE_ACTIVE
	case "draining":
		state = rtcadmissionv1.AdmissionInstanceState_ADMISSION_INSTANCE_STATE_DRAINING
	case "retired":
		state = rtcadmissionv1.AdmissionInstanceState_ADMISSION_INSTANCE_STATE_RETIRED
	default:
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("registration unavailable"))
	}
	return connect.NewResponse(&rtcadmissionv1.RegisterInstanceResponse{Instance: &rtcadmissionv1.AdmissionInstance{InstanceId: result.ID.String(), RegistrationFence: result.Fence, State: state}}), nil
}
func mapError(err error) error {
	code := connect.CodeUnavailable
	message := "registration unavailable"
	switch {
	case errors.Is(err, context.Canceled):
		code = connect.CodeCanceled
		message = "registration canceled"
	case errors.Is(err, context.DeadlineExceeded):
		code = connect.CodeDeadlineExceeded
		message = "registration deadline exceeded"
	case errors.Is(err, domain.ErrInvalidArgument):
		code = connect.CodeInvalidArgument
		message = "invalid registration request"
	case errors.Is(err, domain.ErrDenied):
		code = connect.CodePermissionDenied
		message = "registration caller denied"
	case errors.Is(err, domain.ErrConflict):
		code = connect.CodeAlreadyExists
		message = "registration leaf already bound"
	}
	return connect.NewError(code, errors.New(message))
}
