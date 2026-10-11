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
	"time"

	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/transport/authorization"
)

type InternalAuthorizationConfig struct {
	Enabled      bool
	Address      string
	TLSCertFile  string
	TLSKeyFile   string
	ClientCAFile string
}

func loadInternalAuthorizationConfig() (InternalAuthorizationConfig, error) {
	enabled, err := strconv.ParseBool(lookupString("AERO_CHAT_INTERNAL_AUTHORIZATION_ENABLED", "false"))
	if err != nil {
		return InternalAuthorizationConfig{}, errors.New("invalid private authorization enable flag")
	}
	cfg := InternalAuthorizationConfig{Enabled: enabled, Address: lookupString("AERO_CHAT_INTERNAL_AUTHORIZATION_LISTEN_ADDR", ""), TLSCertFile: lookupString("AERO_CHAT_INTERNAL_AUTHORIZATION_TLS_CERT_FILE", ""), TLSKeyFile: lookupString("AERO_CHAT_INTERNAL_AUTHORIZATION_TLS_KEY_FILE", ""), ClientCAFile: lookupString("AERO_CHAT_INTERNAL_AUTHORIZATION_CLIENT_CA_FILE", "")}
	if err := cfg.validate(); err != nil {
		return InternalAuthorizationConfig{}, err
	}
	return cfg, nil
}

func (c InternalAuthorizationConfig) validate() error {
	if !c.Enabled {
		return nil
	}
	host, port, err := net.SplitHostPort(c.Address)
	if err != nil || host == "" {
		return errors.New("private authorization address requires explicit host and port")
	}
	if _, err := strconv.ParseUint(port, 10, 16); err != nil {
		return errors.New("invalid private authorization port")
	}
	if c.TLSCertFile == "" || c.TLSKeyFile == "" || c.ClientCAFile == "" {
		return errors.New("private authorization TLS files are required")
	}
	return nil
}

func NewInternalAuthorizationServer(cfg InternalAuthorizationConfig, logger *slog.Logger, service authorization.Service) (*http.Server, error) {
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	if !cfg.Enabled {
		return nil, nil
	}
	pair, err := tls.LoadX509KeyPair(cfg.TLSCertFile, cfg.TLSKeyFile)
	if err != nil || len(pair.Certificate) == 0 {
		return nil, errors.New("invalid private authorization TLS keypair")
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
	if !serverUsage || (len(leaf.DNSNames) == 0 && len(leaf.IPAddresses) == 0) {
		return nil, errors.New("private authorization server certificate requires serverAuth and SAN")
	}
	caData, err := os.ReadFile(cfg.ClientCAFile)
	if err != nil {
		return nil, errors.New("cannot read private authorization client CA")
	}
	roots := x509.NewCertPool()
	count := 0
	caData = bytes.TrimSpace(caData)
	for len(caData) > 0 {
		if !bytes.HasPrefix(caData, []byte("-----BEGIN CERTIFICATE-----")) {
			return nil, errors.New("invalid private authorization client CA PEM")
		}
		block, rest := pem.Decode(caData)
		if block == nil || block.Type != "CERTIFICATE" {
			return nil, errors.New("invalid private authorization client CA PEM")
		}
		caData = bytes.TrimSpace(rest)
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil || !cert.IsCA || cert.KeyUsage&x509.KeyUsageCertSign == 0 || time.Now().Before(cert.NotBefore) || !time.Now().Before(cert.NotAfter) {
			return nil, errors.New("invalid private authorization client CA certificate")
		}
		roots.AddCert(cert)
		count++
	}
	if count == 0 {
		return nil, errors.New("private authorization client CA is empty")
	}
	return &http.Server{Addr: cfg.Address, Handler: authorization.NewHTTPHandler(logger, service), TLSConfig: &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{pair}, ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: roots, VerifyConnection: authorization.VerifyCaller}, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 6 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192, ErrorLog: log.New(privateTransportLog{logger}, "", 0)}, nil
}

type privateTransportLog struct{ logger *slog.Logger }

func (l privateTransportLog) Write(p []byte) (int, error) {
	l.logger.Debug("private authorization transport rejected request")
	return len(p), nil
}

func runPrivateAuthorization(ctx context.Context, srv *http.Server, listener net.Listener, shutdown time.Duration) error {
	result := make(chan error, 1)
	go func() { result <- srv.ServeTLS(listener, "", "") }()
	select {
	case err := <-result:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		cleanup, cancel := context.WithTimeout(context.Background(), shutdown)
		defer cancel()
		if err := srv.Shutdown(cleanup); err != nil {
			_ = srv.Close()
			return err
		}
		return <-result
	}
}

func RunHTTPServers(ctx context.Context, logger *slog.Logger, publicCfg observability.HTTPServerConfig, public http.Handler, privateCfg InternalAuthorizationConfig, service authorization.Service) error {
	private, err := NewInternalAuthorizationServer(privateCfg, logger, service)
	if err != nil {
		return err
	}
	if private == nil {
		return observability.RunHTTPServer(ctx, logger, publicCfg, public)
	}
	listener, err := net.Listen("tcp", private.Addr)
	if err != nil {
		return errors.New("private authorization listener unavailable")
	}
	defer func() { _ = listener.Close() }()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	results := make(chan error, 2)
	go func() { results <- observability.RunHTTPServer(ctx, logger, publicCfg, public) }()
	go func() { results <- runPrivateAuthorization(ctx, private, listener, publicCfg.ShutdownTimeout) }()
	var cause error
	for i := 0; i < 2; i++ {
		if err := <-results; err != nil && !errors.Is(err, http.ErrServerClosed) && !errors.Is(err, context.Canceled) && cause == nil {
			cause = err
		}
		cancel()
	}
	return cause
}
