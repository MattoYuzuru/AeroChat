package app

import (
	"log/slog"
	"net/http"

	chatv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1/chatv1connect"
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
)

func NewHTTPHandler(
	logger *slog.Logger,
	meta observability.ServiceMeta,
	readinessCheck observability.ReadinessCheck,
	handler chatv1connect.ChatServiceHandler,
) http.Handler {
	diagnosticsMux := observability.NewBaseMux(meta, logger, readinessCheck)
	connectMux := http.NewServeMux()

	path, connectHandler := chatv1connect.NewChatServiceHandler(handler)
	connectMux.Handle(path, connectHandler)
	loggedConnectMux := observability.WrapHTTPInstrumentation(logger, connectMux)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/":
			diagnosticsMux.ServeHTTP(w, r)
		case r.Method == http.MethodGet && r.URL.Path == "/healthz":
			diagnosticsMux.ServeHTTP(w, r)
		case r.Method == http.MethodGet && r.URL.Path == "/readyz":
			diagnosticsMux.ServeHTTP(w, r)
		default:
			loggedConnectMux.ServeHTTP(w, r)
		}
	})
}
