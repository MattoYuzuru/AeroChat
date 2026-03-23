package app

import (
	"log/slog"
	"net/http"

	rtcv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1/rtcv1connect"
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
)

func NewHTTPHandler(
	logger *slog.Logger,
	meta observability.ServiceMeta,
	readinessCheck observability.ReadinessCheck,
	handler rtcv1connect.RtcControlServiceHandler,
) http.Handler {
	diagnosticsMux := observability.NewBaseMux(meta, logger, readinessCheck)
	connectMux := http.NewServeMux()

	path, connectHandler := rtcv1connect.NewRtcControlServiceHandler(handler)
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
