package app

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"io"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"connectrpc.com/connect"
	identityauthorizationv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/authorization/v1"
	"github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/authorization/v1/identityauthorizationv1connect"
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/domain/identity"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/transport/authorization"
	connecthandler "github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/transport/connect"
)

type authorityTestCA struct {
	certificate *x509.Certificate
	key         *ecdsa.PrivateKey
	roots       *x509.CertPool
	serial      int64
}

type authorityLogBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (b *authorityLogBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.Write(p)
}
func (b *authorityLogBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.String()
}

func authorityCA(t *testing.T) *authorityTestCA {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	cert := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "owned-authority-fixture"}, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature}
	der, err := x509.CreateCertificate(rand.Reader, cert, cert, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(parsed)
	return &authorityTestCA{certificate: parsed, key: key, roots: roots, serial: 1}
}

func authorityLeaf(t *testing.T, ca *authorityTestCA, usage x509.ExtKeyUsage, principals []string, expired bool) tls.Certificate {
	t.Helper()
	ca.serial++
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	cert := &x509.Certificate{SerialNumber: big.NewInt(ca.serial), NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{usage}}
	if expired {
		cert.NotBefore = time.Now().Add(-time.Hour)
		cert.NotAfter = time.Now().Add(-time.Minute)
	}
	if usage == x509.ExtKeyUsageServerAuth {
		cert.DNSNames = []string{"localhost"}
		cert.IPAddresses = []net.IP{net.ParseIP("127.0.0.1")}
	}
	for _, principal := range principals {
		uri, err := url.Parse(principal)
		if err != nil {
			t.Fatal(err)
		}
		cert.URIs = append(cert.URIs, uri)
	}
	der, err := x509.CreateCertificate(rand.Reader, cert, ca.certificate, &key.PublicKey, ca.key)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	pair, err := tls.X509KeyPair(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded}))
	if err != nil {
		t.Fatal(err)
	}
	return pair
}

func authorityTLSConfig(t *testing.T, ca *authorityTestCA) InternalAuthorizationConfig {
	t.Helper()
	dir := t.TempDir()
	server := authorityLeaf(t, ca, x509.ExtKeyUsageServerAuth, nil, false)
	key, err := x509.MarshalPKCS8PrivateKey(server.PrivateKey)
	if err != nil {
		t.Fatal(err)
	}
	cfg := InternalAuthorizationConfig{Enabled: true, Address: "127.0.0.1:0", TLSCertFile: filepath.Join(dir, "server.crt"), TLSKeyFile: filepath.Join(dir, "server.key"), ClientCAFile: filepath.Join(dir, "client-ca.crt")}
	for file, data := range map[string][]byte{cfg.TLSCertFile: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate[0]}), cfg.TLSKeyFile: pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: key}), cfg.ClientCAFile: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: ca.certificate.Raw})} {
		if err := os.WriteFile(file, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return cfg
}

func authorityHTTPS(t *testing.T, cfg InternalAuthorizationConfig, logger *slog.Logger, service authorization.Service) string {
	t.Helper()
	server, err := NewInternalAuthorizationServer(cfg, logger, service)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- runInternalAuthorizationServer(ctx, server, listener, time.Second) }()
	t.Cleanup(func() {
		cancel()
		if err := <-done; err != nil {
			t.Error("owned authority server did not shut down cleanly")
		}
	})
	return "https://" + listener.Addr().String()
}

func authorityHTTPClient(t *testing.T, ca *authorityTestCA, leaf *tls.Certificate) *http.Client {
	t.Helper()
	cfg := &tls.Config{RootCAs: ca.roots, ServerName: "localhost", MinVersion: tls.VersionTLS13}
	if leaf != nil {
		cfg.Certificates = []tls.Certificate{*leaf}
	}
	transport := &http.Transport{TLSClientConfig: cfg}
	t.Cleanup(transport.CloseIdleConnections)
	return &http.Client{Transport: transport, Timeout: 6 * time.Second}
}

type authorityServiceSpy struct {
	calls atomic.Int32
	bound func(context.Context) (*identity.SessionAuthority, error)
}

func (s *authorityServiceSpy) ResolveSessionBearer(ctx context.Context, _ string) (*identity.SessionAuthority, error) {
	s.calls.Add(1)
	return s.result(ctx)
}
func (s *authorityServiceSpy) CheckBoundSession(ctx context.Context, _, _, _ string) (*identity.SessionAuthority, error) {
	s.calls.Add(1)
	return s.result(ctx)
}
func (s *authorityServiceSpy) result(ctx context.Context) (*identity.SessionAuthority, error) {
	if s.bound != nil {
		return s.bound(ctx)
	}
	return &identity.SessionAuthority{UserID: "fixture-user", SessionID: "fixture-session", DeviceID: "fixture-device", SessionRevision: 1, DeviceRevision: 1, Status: identity.AuthorityActive}, nil
}

func TestPrivateAuthorityTLSCallerAndPublicRoute(t *testing.T) {
	ca := authorityCA(t)
	cfg := authorityTLSConfig(t, ca)
	var logs authorityLogBuffer
	logger := slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	spy := &authorityServiceSpy{}
	address := authorityHTTPS(t, cfg, logger, spy)
	valid := authorityLeaf(t, ca, x509.ExtKeyUsageClientAuth, []string{authorization.CallerURI}, false)
	client := identityauthorizationv1connect.NewInternalAuthorizationServiceClient(authorityHTTPClient(t, ca, &valid), address)
	if response, err := client.CheckBoundSession(context.Background(), connect.NewRequest(&identityauthorizationv1.CheckBoundSessionRequest{})); err != nil || response.Msg.Authority.Status != identityauthorizationv1.AuthorityStatus_AUTHORITY_STATUS_ACTIVE {
		t.Fatal("valid mTLS caller rejected")
	}
	wrongCA := authorityCA(t)
	for name, cert := range map[string]*tls.Certificate{
		"no certificate": nil,
		"wrong CA": func() *tls.Certificate {
			v := authorityLeaf(t, wrongCA, x509.ExtKeyUsageClientAuth, []string{authorization.CallerURI}, false)
			return &v
		}(),
		"wrong URI": func() *tls.Certificate {
			v := authorityLeaf(t, ca, x509.ExtKeyUsageClientAuth, []string{"urn:aerochat:service:media-admission"}, false)
			return &v
		}(),
		"ambiguous URI": func() *tls.Certificate {
			v := authorityLeaf(t, ca, x509.ExtKeyUsageClientAuth, []string{authorization.CallerURI, "urn:aerochat:service:identity"}, false)
			return &v
		}(),
		"expired": func() *tls.Certificate {
			v := authorityLeaf(t, ca, x509.ExtKeyUsageClientAuth, []string{authorization.CallerURI}, true)
			return &v
		}(),
		"wrong usage": func() *tls.Certificate {
			v := authorityLeaf(t, ca, x509.ExtKeyUsageServerAuth, []string{authorization.CallerURI}, false)
			return &v
		}(),
	} {
		t.Run(name, func(t *testing.T) {
			before := spy.calls.Load()
			rpc := identityauthorizationv1connect.NewInternalAuthorizationServiceClient(authorityHTTPClient(t, ca, cert), address)
			request := connect.NewRequest(&identityauthorizationv1.CheckBoundSessionRequest{})
			request.Header().Set("X-Service-Principal", authorization.CallerURI)
			if _, err := rpc.CheckBoundSession(context.Background(), request); err == nil {
				t.Fatal("untrusted TLS caller admitted")
			}
			if spy.calls.Load() != before {
				t.Fatal("untrusted TLS caller reached domain")
			}
		})
	}
	public := httptest.NewServer(NewHTTPHandler(logger, observability.ServiceMeta{Name: "identity-fixture"}, nil, connecthandler.NewHandler("identity-fixture", "test", nil)))
	defer public.Close()
	publicClient := identityauthorizationv1connect.NewInternalAuthorizationServiceClient(public.Client(), public.URL)
	if _, err := publicClient.CheckBoundSession(context.Background(), connect.NewRequest(&identityauthorizationv1.CheckBoundSessionRequest{})); err == nil {
		t.Fatal("public route exposed internal authority")
	}
	if spy.calls.Load() != 1 {
		t.Fatal("public route reached private authority service")
	}
	if strings.Contains(logs.String(), "fixture-user") || strings.Contains(logs.String(), "fixture-session") || strings.Contains(logs.String(), "X-Service-Principal") {
		t.Fatal("private subject/request data was logged")
	}
}

func TestPrivateAuthorityDeadlineAndFailure(t *testing.T) {
	ca := authorityCA(t)
	cfg := authorityTLSConfig(t, ca)
	var seen atomic.Bool
	spy := &authorityServiceSpy{bound: func(ctx context.Context) (*identity.SessionAuthority, error) {
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > 5*time.Second {
			return nil, errors.New("missing bounded deadline")
		}
		seen.Store(true)
		<-ctx.Done()
		return nil, ctx.Err()
	}}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	address := authorityHTTPS(t, cfg, logger, spy)
	leaf := authorityLeaf(t, ca, x509.ExtKeyUsageClientAuth, []string{authorization.CallerURI}, false)
	client := identityauthorizationv1connect.NewInternalAuthorizationServiceClient(authorityHTTPClient(t, ca, &leaf), address)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if _, err := client.CheckBoundSession(ctx, connect.NewRequest(&identityauthorizationv1.CheckBoundSessionRequest{})); err == nil {
		t.Fatal("deadline request returned authority")
	}
	if !seen.Load() {
		t.Fatal("bounded deadline was not observed by domain")
	}
}

func TestPrivateAuthorityConfigurationFailClosed(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	server, err := NewInternalAuthorizationServer(InternalAuthorizationConfig{}, logger, &authorityServiceSpy{})
	if err != nil || server != nil {
		t.Fatal("disabled config created listener")
	}
	for _, cfg := range []InternalAuthorizationConfig{{Enabled: true}, {Enabled: true, Address: "127.0.0.1:0"}, {Enabled: true, Address: "127.0.0.1:bad", TLSCertFile: "file", TLSKeyFile: "file", ClientCAFile: "file"}} {
		if _, err := NewInternalAuthorizationServer(cfg, logger, &authorityServiceSpy{}); err == nil {
			t.Fatal("invalid enabled config accepted")
		}
	}
	ca := authorityCA(t)
	cfg := authorityTLSConfig(t, ca)
	if err := os.WriteFile(cfg.ClientCAFile, []byte("public-invalid-fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewInternalAuthorizationServer(cfg, logger, &authorityServiceSpy{}); err == nil {
		t.Fatal("invalid client CA accepted")
	}
	t.Setenv("AERO_IDENTITY_INTERNAL_AUTHORIZATION_ENABLED", "false")
	if cfg, err := LoadConfig(":8081"); err != nil || cfg.InternalAuthorization.Enabled {
		t.Fatal("private listener not disabled by default")
	}
	t.Setenv("AERO_IDENTITY_INTERNAL_AUTHORIZATION_ENABLED", "invalid")
	if _, err := LoadConfig(":8081"); err == nil {
		t.Fatal("invalid enabled flag accepted")
	}
}
