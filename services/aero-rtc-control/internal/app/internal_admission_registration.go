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
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/transport/admission"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/transport/revocation"
)

type InternalAdmissionRegistrationConfig struct {
	Enabled                                        bool
	Address, TLSCertFile, TLSKeyFile, ClientCAFile string
}

func loadInternalAdmissionRegistrationConfig() (InternalAdmissionRegistrationConfig, error) {
	enabled, err := strconv.ParseBool(lookupString("AERO_RTC_INTERNAL_ADMISSION_REGISTRATION_ENABLED", "false"))
	if err != nil {
		return InternalAdmissionRegistrationConfig{}, errors.New("invalid admission registration enabled flag")
	}
	cfg := InternalAdmissionRegistrationConfig{Enabled: enabled, Address: lookupString("AERO_RTC_INTERNAL_ADMISSION_REGISTRATION_LISTEN_ADDR", ""), TLSCertFile: lookupString("AERO_RTC_INTERNAL_ADMISSION_REGISTRATION_TLS_CERT_FILE", ""), TLSKeyFile: lookupString("AERO_RTC_INTERNAL_ADMISSION_REGISTRATION_TLS_KEY_FILE", ""), ClientCAFile: lookupString("AERO_RTC_INTERNAL_ADMISSION_REGISTRATION_CLIENT_CA_FILE", "")}
	return cfg, cfg.validate()
}
func (c InternalAdmissionRegistrationConfig) validate() error {
	if !c.Enabled {
		return nil
	}
	host, port, err := net.SplitHostPort(c.Address)
	if err != nil || host == "" {
		return errors.New("registration requires explicit host and port")
	}
	if _, err := strconv.ParseUint(port, 10, 16); err != nil {
		return errors.New("registration port invalid")
	}
	if c.TLSCertFile == "" || c.TLSKeyFile == "" || c.ClientCAFile == "" {
		return errors.New("registration TLS files required")
	}
	return nil
}

type registrationTransportLog struct{ logger *slog.Logger }

func (l registrationTransportLog) Write(data []byte) (int, error) {
	l.logger.Debug("private registration TLS request rejected")
	return len(data), nil
}
func NewInternalAdmissionRegistrationServer(cfg InternalAdmissionRegistrationConfig, logger *slog.Logger, service admission.Service) (*http.Server, error) {
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	if !cfg.Enabled {
		return nil, nil
	}
	pair, err := tls.LoadX509KeyPair(cfg.TLSCertFile, cfg.TLSKeyFile)
	if err != nil || len(pair.Certificate) == 0 {
		return nil, errors.New("registration TLS keypair invalid")
	}
	leaf, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil || leaf.IsCA || time.Now().Before(leaf.NotBefore) || !time.Now().Before(leaf.NotAfter) {
		return nil, errors.New("registration server certificate invalid")
	}
	usage := false
	for _, u := range leaf.ExtKeyUsage {
		if u == x509.ExtKeyUsageServerAuth {
			usage = true
		}
	}
	if !usage || len(leaf.DNSNames)+len(leaf.IPAddresses) == 0 {
		return nil, errors.New("registration server requires serverAuth and SAN")
	}
	data, err := os.ReadFile(cfg.ClientCAFile)
	if err != nil {
		return nil, errors.New("registration client CA unavailable")
	}
	roots := x509.NewCertPool()
	count := 0
	data = bytes.TrimSpace(data)
	for len(data) > 0 {
		if !bytes.HasPrefix(data, []byte("-----BEGIN CERTIFICATE-----")) {
			return nil, errors.New("registration client CA PEM invalid")
		}
		block, rest := pem.Decode(data)
		if block == nil || block.Type != "CERTIFICATE" {
			return nil, errors.New("registration client CA PEM invalid")
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil || !cert.IsCA || cert.KeyUsage&x509.KeyUsageCertSign == 0 || time.Now().Before(cert.NotBefore) || !time.Now().Before(cert.NotAfter) {
			return nil, errors.New("registration client CA invalid")
		}
		roots.AddCert(cert)
		count++
		data = bytes.TrimSpace(rest)
	}
	if count == 0 {
		return nil, errors.New("registration client CA required")
	}
	return &http.Server{Addr: cfg.Address, Handler: admission.NewHTTPHandler(logger, service), TLSConfig: &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{pair}, ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: roots, VerifyConnection: admission.VerifyCaller}, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 6 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192, ErrorLog: log.New(registrationTransportLog{logger}, "", 0)}, nil
}
func RunHTTPServersWithRegistration(ctx context.Context, logger *slog.Logger, publicCfg observability.HTTPServerConfig, public http.Handler, sourceCfg InternalRevocationConfig, source revocation.Service, registrationCfg InternalAdmissionRegistrationConfig, registration admission.Service) error {
	server, err := NewInternalAdmissionRegistrationServer(registrationCfg, logger, registration)
	if err != nil {
		return err
	}
	if server == nil {
		return RunHTTPServers(ctx, logger, publicCfg, public, sourceCfg, source)
	}
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return errors.New("private registration listener unavailable")
	}
	defer func() { _ = listener.Close() }()
	child, cancel := context.WithCancel(ctx)
	defer cancel()
	server.BaseContext = func(net.Listener) context.Context { return child }
	results := make(chan error, 2)
	go func() { results <- runPrivateRevocation(child, server, listener, publicCfg.ShutdownTimeout) }()
	go func() { results <- RunHTTPServers(child, logger, publicCfg, public, sourceCfg, source) }()
	var cause error
	for i := 0; i < 2; i++ {
		if err := <-results; err != nil && !errors.Is(err, http.ErrServerClosed) && !errors.Is(err, context.Canceled) && cause == nil {
			cause = err
		}
		cancel()
	}
	return cause
}
