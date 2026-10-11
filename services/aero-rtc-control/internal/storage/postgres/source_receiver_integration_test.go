package postgres

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
	rpc "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/revocation/v1"
	rc "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/revocation/v1/rtcrevocationv1connect"
	"github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1/rtcv1connect"
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/app"
	media "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediastore"
	domain "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/revocation"
	transport "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/transport/revocation"
	"github.com/google/uuid"
)

type receiverLog struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (b *receiverLog) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.Write(p)
}
func (b *receiverLog) String() string { b.mu.Lock(); defer b.mu.Unlock(); return b.b.String() }

type receiverCA struct {
	cert *x509.Certificate
	key  *ecdsa.PrivateKey
	pem  []byte
}

func newReceiverCA(t *testing.T) receiverCA {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal("CA key fixture")
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: pkix.Name{CommonName: "Owned receiver fixture CA"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal("CA fixture")
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal("CA parse")
	}
	return receiverCA{cert: cert, key: key, pem: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})}
}
func receiverLeaf(t *testing.T, ca receiverCA, principals []string, server, expired, wrongUsage bool) (tls.Certificate, []byte, []byte) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal("leaf key fixture")
	}
	leaf := &x509.Certificate{SerialNumber: big.NewInt(time.Now().UnixNano()), NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}
	if server || wrongUsage {
		leaf.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}
	}
	if server {
		leaf.DNSNames = []string{"localhost"}
		leaf.IPAddresses = []net.IP{net.ParseIP("127.0.0.1")}
	}
	if expired {
		leaf.NotAfter = time.Now().Add(-time.Minute)
	}
	for _, principal := range principals {
		u, err := url.Parse(principal)
		if err != nil {
			t.Fatal("fixture URI")
		}
		leaf.URIs = append(leaf.URIs, u)
	}
	der, err := x509.CreateCertificate(rand.Reader, leaf, ca.cert, &key.PublicKey, ca.key)
	if err != nil {
		t.Fatal("leaf fixture")
	}
	raw, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatal("leaf encoding")
	}
	certPEM, keyPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: raw})
	pair, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		t.Fatal("leaf pair")
	}
	return pair, certPEM, keyPEM
}
func receiverClient(t *testing.T, address string, ca receiverCA, pair *tls.Certificate, maxVersion uint16) rc.SourceRevocationServiceClient {
	t.Helper()
	roots := x509.NewCertPool()
	roots.AddCert(ca.cert)
	cfg := &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: roots}
	if pair != nil {
		cfg.Certificates = []tls.Certificate{*pair}
	}
	if maxVersion != 0 {
		cfg.MinVersion = maxVersion
		cfg.MaxVersion = maxVersion
	}
	tr := &http.Transport{TLSClientConfig: cfg, ForceAttemptHTTP2: false}
	t.Cleanup(tr.CloseIdleConnections)
	return rc.NewSourceRevocationServiceClient(&http.Client{Transport: tr, Timeout: 2 * time.Second}, address)
}

type lostReceiverResponse struct {
	inner http.RoundTripper
	drop  atomic.Bool
}

func (t *lostReceiverResponse) RoundTrip(r *http.Request) (*http.Response, error) {
	response, err := t.inner.RoundTrip(r)
	if err == nil && t.drop.CompareAndSwap(true, false) {
		_, _ = io.Copy(io.Discard, response.Body)
		_ = response.Body.Close()
		return nil, errors.New("owned response loss")
	}
	return response, err
}

type receiverSpy struct {
	inner *domain.Service
	calls atomic.Int64
}

func (s *receiverSpy) ApplyIdentityEvent(ctx context.Context, e domain.IdentityEvent) (domain.Receipt, error) {
	s.calls.Add(1)
	return s.inner.ApplyIdentityEvent(ctx, e)
}
func (s *receiverSpy) ApplyChatEvent(ctx context.Context, e domain.ChatEvent) (domain.Receipt, error) {
	s.calls.Add(1)
	return s.inner.ApplyChatEvent(ctx, e)
}
func (s *receiverSpy) GetIdentityEventReceipt(ctx context.Context, e string) (domain.Receipt, error) {
	s.calls.Add(1)
	return s.inner.GetIdentityEventReceipt(ctx, e)
}
func (s *receiverSpy) GetChatEventReceipt(ctx context.Context, e string) (domain.Receipt, error) {
	s.calls.Add(1)
	return s.inner.GetChatEventReceipt(ctx, e)
}

func TestPrivateSourceReceiverActualTLSAndDurableReceipt(t *testing.T) {
	db := mediaTestDatabase(t)
	store := NewMediaStore(db)
	spy := &receiverSpy{inner: domain.NewService(store)}
	ca, otherCA := newReceiverCA(t), newReceiverCA(t)
	_, serverCert, serverKey := receiverLeaf(t, ca, nil, true, false, false)
	identity, _, _ := receiverLeaf(t, ca, []string{transport.IdentityCallerURI}, false, false, false)
	chat, _, _ := receiverLeaf(t, ca, []string{transport.ChatCallerURI}, false, false, false)
	dir := t.TempDir()
	cfg := app.InternalRevocationConfig{Enabled: true, Address: "127.0.0.1:0", TLSCertFile: filepath.Join(dir, "server.pem"), TLSKeyFile: filepath.Join(dir, "key.pem"), ClientCAFile: filepath.Join(dir, "ca.pem")}
	for path, data := range map[string][]byte{cfg.TLSCertFile: serverCert, cfg.TLSKeyFile: serverKey, cfg.ClientCAFile: ca.pem} {
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal("fixture file")
		}
	}
	logs := &receiverLog{}
	logger := slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	srv, err := app.NewInternalRevocationServer(cfg, logger, spy)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", cfg.Address)
	if err != nil {
		t.Fatal("fixture listener")
	}
	result := make(chan error, 1)
	go func() { result <- srv.ServeTLS(listener, "", "") }()
	t.Cleanup(func() {
		ctx, done := context.WithTimeout(context.Background(), 3*time.Second)
		defer done()
		if err := srv.Shutdown(ctx); err != nil {
			_ = srv.Close()
		}
		select {
		case <-result:
		case <-time.After(3 * time.Second):
			t.Error("owned TLS server did not stop")
		}
	})
	address := "https://" + listener.Addr().String()
	identityClient, chatClient := receiverClient(t, address, ca, &identity, 0), receiverClient(t, address, ca, &chat, 0)
	call, group, user := mediaTestCall(t, db)
	event := uuid.NewString()
	ctx := context.Background()
	applyChat := connect.NewRequest(&rpc.ApplyChatEventRequest{EventId: event, GroupId: group.String(), UserId: user.String(), EligibilityEpoch: 2})
	noMatch, err := chatClient.ApplyChatEvent(ctx, applyChat)
	if err != nil || noMatch.Msg.Receipt.RegistryMediaEffect != rpc.RegistryMediaEffect_REGISTRY_MEDIA_EFFECT_NO_MATCHING_REGISTRY_GRANTS || noMatch.Msg.Receipt.AffectedRegistryGrants != 0 {
		t.Fatal("empty registry receipt was not factual")
	}
	repeated, err := chatClient.ApplyChatEvent(ctx, applyChat)
	if err != nil || repeated.Msg.Receipt.OperationId != noMatch.Msg.Receipt.OperationId {
		t.Fatal("event replay changed operation")
	}
	changed := connect.NewRequest(&rpc.ApplyChatEventRequest{EventId: event, GroupId: group.String(), UserId: user.String(), EligibilityEpoch: 3})
	if _, err := chatClient.ApplyChatEvent(ctx, changed); connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatal("changed canonical event accepted")
	}
	request := mediaTestRequest(call, group, user)
	request.EligibilityEpoch = 3
	g := mustMediaActivate(t, store, mustMediaReserve(t, store, request))
	owner := media.Owner{ID: uuid.New(), Fence: 1}
	if _, err := store.RegisterLease(ctx, g.Key, g.Authority, uuid.New(), owner, time.Now()); err != nil {
		t.Fatal(err)
	}
	historical, err := chatClient.GetChatEventReceipt(ctx, connect.NewRequest(&rpc.GetChatEventReceiptRequest{EventId: event}))
	if err != nil || historical.Msg.Receipt.AffectedRegistryGrants != 0 {
		t.Fatal("old event counted fresh eligible grant")
	}
	sessionEvent := uuid.NewString()
	req := connect.NewRequest(&rpc.ApplyIdentityEventRequest{EventId: sessionEvent, Kind: rpc.IdentityEventKind_IDENTITY_EVENT_KIND_SESSION, SubjectId: g.SessionID.String(), UserId: user.String(), DeviceId: g.DeviceID.String(), SourceRevision: 2})
	req.Header().Set("Authorization", "Bearer owned-sensitive-fixture-marker")
	pending, err := identityClient.ApplyIdentityEvent(ctx, req)
	if err != nil || pending.Msg.Receipt.RegistryMediaEffect != rpc.RegistryMediaEffect_REGISTRY_MEDIA_EFFECT_MEDIA_PENDING || pending.Msg.Receipt.AffectedRegistryGrants != 1 {
		t.Fatal("distinct key receipt not pending")
	}
	var actions int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM rtc_media_cleanup_outbox WHERE operation_id=$1", pending.Msg.Receipt.OperationId).Scan(&actions); err != nil || actions != 2 {
		t.Fatal("fixture requires two actions per single key")
	}
	operation := media.Operation{ID: uuid.MustParse(pending.Msg.Receipt.OperationId)}
	for _, action := range []string{"proxy", "sfu"} {
		claim := mustMediaClaim(t, store, operation, g, action)
		if _, err := store.RecordCleanupAcknowledgement(ctx, claim, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	// Journal completion test-only не получает право объявлять реальное media complete.
	after, err := identityClient.GetIdentityEventReceipt(ctx, connect.NewRequest(&rpc.GetIdentityEventReceiptRequest{EventId: sessionEvent}))
	if err != nil || after.Msg.Receipt.RegistryMediaEffect != rpc.RegistryMediaEffect_REGISTRY_MEDIA_EFFECT_MEDIA_PENDING || after.Msg.Receipt.AffectedRegistryGrants != 1 {
		t.Fatal("journal completion surfaced as media completion")
	}
	if _, err := chatClient.GetChatEventReceipt(ctx, connect.NewRequest(&rpc.GetChatEventReceiptRequest{EventId: sessionEvent})); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatal("own receipt crossed domain")
	}

	allCalls := func(client rc.SourceRevocationServiceClient) []error {
		a := connect.NewRequest(&rpc.ApplyIdentityEventRequest{EventId: uuid.NewString(), Kind: rpc.IdentityEventKind_IDENTITY_EVENT_KIND_DEVICE, SubjectId: g.DeviceID.String(), DeviceId: g.DeviceID.String(), UserId: user.String(), SourceRevision: 2})
		a.Header().Set("X-Aero-Caller", transport.IdentityCallerURI)
		_, e1 := client.ApplyIdentityEvent(ctx, a)
		_, e2 := client.ApplyChatEvent(ctx, connect.NewRequest(&rpc.ApplyChatEventRequest{EventId: uuid.NewString(), GroupId: group.String(), UserId: user.String(), EligibilityEpoch: 2}))
		_, e3 := client.GetIdentityEventReceipt(ctx, connect.NewRequest(&rpc.GetIdentityEventReceiptRequest{EventId: sessionEvent}))
		_, e4 := client.GetChatEventReceipt(ctx, connect.NewRequest(&rpc.GetChatEventReceiptRequest{EventId: event}))
		return []error{e1, e2, e3, e4}
	}
	wrongCA, _, _ := receiverLeaf(t, otherCA, []string{transport.IdentityCallerURI}, false, false, false)
	wrongURI, _, _ := receiverLeaf(t, ca, []string{"urn:aerochat:service:rtc-control"}, false, false, false)
	ambiguous, _, _ := receiverLeaf(t, ca, []string{transport.IdentityCallerURI, transport.ChatCallerURI}, false, false, false)
	expired, _, _ := receiverLeaf(t, ca, []string{transport.IdentityCallerURI}, false, true, false)
	wrongEKU, _, _ := receiverLeaf(t, ca, []string{transport.IdentityCallerURI}, false, false, true)
	for _, test := range []struct {
		name    string
		pair    *tls.Certificate
		version uint16
	}{{"absent", nil, 0}, {"wrongCA", &wrongCA, 0}, {"wrongURI", &wrongURI, 0}, {"ambiguous", &ambiguous, 0}, {"expired", &expired, 0}, {"wrongEKU", &wrongEKU, 0}, {"TLS12", &identity, tls.VersionTLS12}} {
		t.Run(test.name, func(t *testing.T) {
			baseline := spy.calls.Load()
			for _, err := range allCalls(receiverClient(t, address, ca, test.pair, test.version)) {
				if err == nil {
					t.Fatal("forbidden certificate opened method")
				}
			}
			if spy.calls.Load() != baseline {
				t.Fatal("forbidden caller reached domain")
			}
		})
	}
	t.Run("method_domain_acl", func(t *testing.T) {
		before := spy.calls.Load()
		_, e1 := identityClient.ApplyChatEvent(ctx, applyChat)
		_, e2 := identityClient.GetChatEventReceipt(ctx, connect.NewRequest(&rpc.GetChatEventReceiptRequest{EventId: event}))
		_, e3 := chatClient.ApplyIdentityEvent(ctx, req)
		_, e4 := chatClient.GetIdentityEventReceipt(ctx, connect.NewRequest(&rpc.GetIdentityEventReceiptRequest{EventId: sessionEvent}))
		for _, err := range []error{e1, e2, e3, e4} {
			if err == nil {
				t.Fatal("owning principal opened foreign method")
			}
		}
		if spy.calls.Load() != before {
			t.Fatal("foreign method reached domain")
		}
	})
	for _, test := range []struct {
		name   string
		h      http.Handler
		status int
	}{{"raw", transport.NewHTTPHandler(logger, spy), http.StatusForbidden}, {"public", app.NewHTTPHandler(logger, observability.ServiceMeta{Name: "owned-fixture"}, nil, &rtcv1connect.UnimplementedRtcControlServiceHandler{}), http.StatusNotFound}} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(test.h)
			defer server.Close()
			baseline := spy.calls.Load()
			for _, path := range []string{rc.SourceRevocationServiceApplyIdentityEventProcedure, rc.SourceRevocationServiceApplyChatEventProcedure, rc.SourceRevocationServiceGetIdentityEventReceiptProcedure, rc.SourceRevocationServiceGetChatEventReceiptProcedure} {
				r, err := http.NewRequest(http.MethodPost, server.URL+path, strings.NewReader("{}"))
				if err != nil {
					t.Fatal(err)
				}
				r.Header.Set("Content-Type", "application/json")
				r.Header.Set("X-Aero-Caller", transport.IdentityCallerURI)
				r.Header.Set("Authorization", "Bearer owned-sensitive-fixture-marker")
				response, err := server.Client().Do(r)
				if err != nil {
					t.Fatal("owned raw call")
				}
				_, _ = io.Copy(io.Discard, response.Body)
				_ = response.Body.Close()
				if response.StatusCode != test.status {
					t.Fatal("private method exposed on raw/public route")
				}
			}
			if spy.calls.Load() != baseline {
				t.Fatal("raw/public reached domain")
			}
		})
	}
	t.Run("lost_response_after_commit", func(t *testing.T) {
		roots := x509.NewCertPool()
		roots.AddCert(ca.cert)
		inner := &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: roots, Certificates: []tls.Certificate{chat}}}
		defer inner.CloseIdleConnections()
		drop := &lostReceiverResponse{inner: inner}
		drop.drop.Store(true)
		client := rc.NewSourceRevocationServiceClient(&http.Client{Transport: drop, Timeout: 2 * time.Second}, address)
		lostEvent := uuid.NewString()
		r := connect.NewRequest(&rpc.ApplyChatEventRequest{EventId: lostEvent, GroupId: group.String(), UserId: user.String(), EligibilityEpoch: 4})
		if _, err := client.ApplyChatEvent(ctx, r); err == nil {
			t.Fatal("fixture did not lose committed response")
		}
		receipt, err := chatClient.GetChatEventReceipt(ctx, connect.NewRequest(&rpc.GetChatEventReceiptRequest{EventId: lostEvent}))
		if err != nil {
			t.Fatal("committed event lost after response loss")
		}
		repeated, err := chatClient.ApplyChatEvent(ctx, r)
		if err != nil || repeated.Msg.Receipt.OperationId != receipt.Msg.Receipt.OperationId {
			t.Fatal("lost response retry changed operation")
		}
	})
	t.Run("oversize_body", func(t *testing.T) {
		before := spy.calls.Load()
		_, err := identityClient.GetIdentityEventReceipt(ctx, connect.NewRequest(&rpc.GetIdentityEventReceiptRequest{EventId: strings.Repeat("x", 5000)}))
		if connect.CodeOf(err) != connect.CodeResourceExhausted || spy.calls.Load() != before {
			t.Fatal("oversize body reached domain")
		}
	})
	for name, pemData := range map[string][]byte{"empty": nil, "garbage": []byte("owned-ca-garbage"), "leaf": serverCert, "key": serverKey} {
		t.Run("startup_ca_"+name, func(t *testing.T) {
			path := filepath.Join(dir, "badca-"+name+".pem")
			if err := os.WriteFile(path, pemData, 0600); err != nil {
				t.Fatal("bad CA fixture")
			}
			bad := cfg
			bad.ClientCAFile = path
			if _, err := app.NewInternalRevocationServer(bad, logger, spy); err == nil {
				t.Fatal("invalid CA did not fail startup")
			}
		})
	}
	t.Run("cancel_blocked_receipt", func(t *testing.T) {
		blocker, err := db.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer rollbackMedia(blocker)
		if _, err := blocker.Exec(ctx, "LOCK TABLE rtc_media_source_inbox IN ACCESS EXCLUSIVE MODE"); err != nil {
			t.Fatal(err)
		}
		deadline, done := context.WithTimeout(ctx, time.Second)
		defer done()
		started := time.Now()
		type receiptResult struct {
			response *connect.Response[rpc.GetIdentityEventReceiptResponse]
			err      error
		}
		finished := make(chan receiptResult, 1)
		go func() {
			r, err := identityClient.GetIdentityEventReceipt(deadline, connect.NewRequest(&rpc.GetIdentityEventReceiptRequest{EventId: sessionEvent}))
			finished <- receiptResult{response: r, err: err}
		}()
		waitForMediaLock(t, deadline, db, db.Config().ConnConfig.RuntimeParams["application_name"])
		outcome := <-finished
		response, err := outcome.response, outcome.err
		if err == nil || response != nil || time.Since(started) > 2*time.Second {
			t.Fatal("blocked receipt exceeded caller budget or returned DTO")
		}
		if err := blocker.Rollback(ctx); err != nil {
			t.Fatal(err)
		}
		if _, err := identityClient.GetIdentityEventReceipt(ctx, connect.NewRequest(&rpc.GetIdentityEventReceiptRequest{EventId: sessionEvent})); err != nil {
			t.Fatal("receiver did not recover after cancellation")
		}
	})
	for _, marker := range []string{"owned-sensitive-fixture-marker", user.String(), group.String(), event, sessionEvent, g.SessionID.String(), g.DeviceID.String(), "PRIVATE KEY"} {
		if strings.Contains(logs.String(), marker) {
			t.Fatal("private payload identifier leaked to logs")
		}
	}
}
