package app

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"log"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/transport/authorization"
)

type InternalAuthorizationConfig struct {
	Enabled      bool
	Address      string
	TLSCertFile  string
	TLSKeyFile   string
	ClientCAFile string
}

func loadInternalAuthorizationConfig() (InternalAuthorizationConfig, error) {
	enabled, err := strconv.ParseBool(lookupString("AERO_IDENTITY_INTERNAL_AUTHORIZATION_ENABLED", "false"))
	if err != nil {
		return InternalAuthorizationConfig{}, errors.New("invalid private authorization enabled flag")
	}
	cfg := InternalAuthorizationConfig{Enabled: enabled, Address: lookupString("AERO_IDENTITY_INTERNAL_AUTHORIZATION_LISTEN_ADDR", ""), TLSCertFile: lookupString("AERO_IDENTITY_INTERNAL_AUTHORIZATION_TLS_CERT_FILE", ""), TLSKeyFile: lookupString("AERO_IDENTITY_INTERNAL_AUTHORIZATION_TLS_KEY_FILE", ""), ClientCAFile: lookupString("AERO_IDENTITY_INTERNAL_AUTHORIZATION_CLIENT_CA_FILE", "")}
	if err := cfg.Validate(); err != nil {
		return InternalAuthorizationConfig{}, err
	}
	return cfg, nil
}

func (c InternalAuthorizationConfig) Validate() error {
	if !c.Enabled {
		return nil
	}
	host, port, err := net.SplitHostPort(c.Address)
	number, portErr := strconv.Atoi(port)
	if err != nil || portErr != nil || number < 0 || number > 65535 || strings.TrimSpace(host) == "" || c.TLSCertFile == "" || c.TLSKeyFile == "" || c.ClientCAFile == "" {
		return errors.New("private authorization requires explicit address and TLS certificate, key, client CA")
	}
	return nil
}

type privateTransportLog struct{ logger *slog.Logger }

func (l privateTransportLog) Write(p []byte) (int, error) {
	l.logger.Warn("private HTTPS transport rejected request")
	return len(p), nil
}

func NewInternalAuthorizationServer(cfg InternalAuthorizationConfig, logger *slog.Logger, service authorization.Service) (*http.Server, error) {
	if !cfg.Enabled {
		return nil, nil
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	pair, err := tls.LoadX509KeyPair(cfg.TLSCertFile, cfg.TLSKeyFile)
	if err != nil {
		return nil, errors.New("invalid private authorization server TLS material")
	}
	leaf, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil || leaf.IsCA || time.Now().Before(leaf.NotBefore) || !time.Now().Before(leaf.NotAfter) {
		return nil, errors.New("invalid private authorization server certificate")
	}
	serverUsage := false
	for _, usage := range leaf.ExtKeyUsage {
		if usage == x509.ExtKeyUsageServerAuth {
			serverUsage = true
		}
	}
	if !serverUsage || len(leaf.DNSNames)+len(leaf.IPAddresses) == 0 {
		return nil, errors.New("private authorization server certificate requires server usage and SAN")
	}
	ca, err := os.ReadFile(cfg.ClientCAFile)
	if err != nil {
		return nil, errors.New("private authorization client CA unavailable")
	}
	roots := x509.NewCertPool()
	caCount := 0
	for len(bytes.TrimSpace(ca)) > 0 {
		block, rest := pem.Decode(ca)
		if block == nil || block.Type != "CERTIFICATE" {
			return nil, errors.New("invalid private authorization client CA")
		}
		certificate, err := x509.ParseCertificate(block.Bytes)
		if err != nil || !certificate.IsCA || certificate.KeyUsage&x509.KeyUsageCertSign == 0 || time.Now().Before(certificate.NotBefore) || !time.Now().Before(certificate.NotAfter) {
			return nil, errors.New("invalid private authorization client CA")
		}
		roots.AddCert(certificate)
		caCount++
		ca = rest
	}
	if caCount == 0 {
		return nil, errors.New("private authorization client CA required")
	}
	return &http.Server{Addr: cfg.Address, Handler: authorization.NewHTTPHandler(logger, service), TLSConfig: &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{pair}, ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: roots, VerifyConnection: authorization.VerifyCaller}, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 6 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192, ErrorLog: log.New(privateTransportLog{logger}, "", 0)}, nil
}

func runInternalAuthorizationServer(ctx context.Context, server *http.Server, listener net.Listener, shutdownTimeout time.Duration) error {
	results := make(chan error, 1)
	go func() { results <- server.ServeTLS(listener, "", "") }()
	select {
	case err := <-results:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			_ = server.Close()
			return err
		}
		err := <-results
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func RunHTTPServers(ctx context.Context, logger *slog.Logger, cfg Config, publicHandler http.Handler, service authorization.Service) error {
	server, err := NewInternalAuthorizationServer(cfg.InternalAuthorization, logger, service)
	if err != nil {
		return err
	}
	publicConfig := observability.HTTPServerConfig{Address: cfg.HTTPAddress, ShutdownTimeout: cfg.ShutdownTimeout}
	if server == nil {
		return observability.RunHTTPServer(ctx, logger, publicConfig, publicHandler)
	}
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return errors.New("private authorization listener unavailable")
	}
	defer func() { _ = listener.Close() }()
	child, cancel := context.WithCancel(ctx)
	defer cancel()
	results := make(chan error, 2)
	go func() { results <- runInternalAuthorizationServer(child, server, listener, cfg.ShutdownTimeout) }()
	go func() { results <- observability.RunHTTPServer(child, logger, publicConfig, publicHandler) }()
	first := <-results
	cancel()
	second := <-results
	if first != nil && !errors.Is(first, context.Canceled) {
		return first
	}
	return second
}
