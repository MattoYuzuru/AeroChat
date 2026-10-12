package app

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/delivery"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/transport/authorization"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/transport/rtcrevocation"
)

func loadRevocationDeliveryConfig() (rtcrevocation.Config, error) {
	enabled, err := strconv.ParseBool(lookupString("AERO_CHAT_RTC_REVOCATION_DELIVERY_ENABLED", "false"))
	if err != nil {
		return rtcrevocation.Config{}, errors.New("chat source delivery enabled flag invalid")
	}
	cfg := rtcrevocation.Config{Enabled: enabled, BaseURL: lookupString("AERO_CHAT_RTC_REVOCATION_DELIVERY_BASE_URL", ""), ServerCAFile: lookupString("AERO_CHAT_RTC_REVOCATION_DELIVERY_SERVER_CA_FILE", ""), TLSCertFile: lookupString("AERO_CHAT_RTC_REVOCATION_DELIVERY_TLS_CERT_FILE", ""), TLSKeyFile: lookupString("AERO_CHAT_RTC_REVOCATION_DELIVERY_TLS_KEY_FILE", "")}
	return cfg, cfg.Validate()
}
func RunServersWithSourceDelivery(ctx context.Context, logger *slog.Logger, cfg Config, public http.Handler, service authorization.Service, repository delivery.Repository) error {
	client, err := rtcrevocation.NewClient(cfg.RevocationDelivery)
	if err != nil {
		return err
	}
	publicConfig := observability.HTTPServerConfig{Address: cfg.HTTPAddress, ShutdownTimeout: cfg.ShutdownTimeout}
	if client == nil {
		return RunHTTPServers(ctx, logger, publicConfig, public, cfg.InternalAuthorization, service)
	}
	defer client.Close()
	child, cancel := context.WithCancel(ctx)
	defer cancel()
	stopped := make(chan error, 1)
	go func() { stopped <- delivery.NewWorker(repository, client, logger).Run(child) }()
	serverErr := RunHTTPServers(child, logger, publicConfig, public, cfg.InternalAuthorization, service)
	cancel()
	workerErr := <-stopped
	if serverErr != nil {
		return serverErr
	}
	if workerErr != nil && !errors.Is(workerErr, context.Canceled) {
		return workerErr
	}
	return nil
}
