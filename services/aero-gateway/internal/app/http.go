package app

import (
	"log/slog"
	"net/http"

	chatv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1/chatv1connect"
	identityv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1/identityv1connect"
	rtcv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1/rtcv1connect"
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
	"github.com/MattoYuzuru/AeroChat/services/aero-gateway/internal/downstream"
	edgehttp "github.com/MattoYuzuru/AeroChat/services/aero-gateway/internal/edgehttp"
	"github.com/MattoYuzuru/AeroChat/services/aero-gateway/internal/realtime"
	connecthandler "github.com/MattoYuzuru/AeroChat/services/aero-gateway/internal/transport/connect"
)

func NewHTTPHandler(logger *slog.Logger, meta observability.ServiceMeta, cfg Config, clients *downstream.Clients, realtimeHub *realtime.Hub) http.Handler {
	diagnosticsMux := observability.NewBaseMux(meta, logger, clients.ReadinessCheck)
	connectMux := http.NewServeMux()
	realtimeHandler := observability.WrapHTTPInstrumentation(
		logger,
		realtime.NewHandler(logger, realtime.NewIdentityAuthenticator(clients.Identity), realtimeHub, cfg.CORSAllowedOrigins),
	)

	identityPath, identityHandler := identityv1connect.NewIdentityServiceHandler(
		connecthandler.NewIdentityHandler(logger, meta.Name, meta.Version, clients.Identity, realtimeHub),
	)
	connectMux.Handle(identityPath, identityHandler)

	chatPath, chatHandler := chatv1connect.NewChatServiceHandler(
		connecthandler.NewChatHandler(logger, meta.Name, meta.Version, clients.Chat, clients.Identity, realtimeHub),
	)
	connectMux.Handle(chatPath, chatHandler)

	rtcPath, rtcHandler := rtcv1connect.NewRtcControlServiceHandler(
		connecthandler.NewRTCHandler(logger, meta.Name, meta.Version, clients.RTC, clients.Chat, realtimeHub),
	)
	connectMux.Handle(rtcPath, rtcHandler)
	loggedConnectMux := observability.WrapHTTPInstrumentation(logger, connectMux)

	return edgehttp.WrapCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/":
			diagnosticsMux.ServeHTTP(w, r)
		case r.Method == http.MethodGet && r.URL.Path == "/healthz":
			diagnosticsMux.ServeHTTP(w, r)
		case r.Method == http.MethodGet && r.URL.Path == "/readyz":
			diagnosticsMux.ServeHTTP(w, r)
		case r.Method == http.MethodGet && r.URL.Path == realtime.Path:
			realtimeHandler.ServeHTTP(w, r)
		default:
			loggedConnectMux.ServeHTTP(w, r)
		}
	}), cfg.CORSAllowedOrigins)
}
