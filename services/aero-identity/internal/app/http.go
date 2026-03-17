package app

import (
	"log/slog"
	"net/http"

	identityv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1/identityv1connect"
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
)

func NewHTTPHandler(
	logger *slog.Logger,
	meta observability.ServiceMeta,
	readinessCheck observability.ReadinessCheck,
	handler identityv1connect.IdentityServiceHandler,
) http.Handler {
	diagnosticsMux := observability.NewBaseMux(meta, logger, readinessCheck)
	connectMux := http.NewServeMux()

	path, connectHandler := identityv1connect.NewIdentityServiceHandler(handler)
	connectMux.Handle(path, connectHandler)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/":
			diagnosticsMux.ServeHTTP(w, r)
		case r.Method == http.MethodGet && r.URL.Path == "/healthz":
			diagnosticsMux.ServeHTTP(w, r)
		case r.Method == http.MethodGet && r.URL.Path == "/readyz":
			diagnosticsMux.ServeHTTP(w, r)
		default:
			connectMux.ServeHTTP(w, r)
		}
	})
}
