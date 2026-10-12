package postgres

import (
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
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
	"sync/atomic"
	"testing"
	"time"

	"connectrpc.com/connect"
	pb "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/admission/v1"
	rc "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/admission/v1/rtcadmissionv1connect"
	sourcepb "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/revocation/v1"
	"github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1/rtcv1connect"
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/app"
	domain "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/admission"
	sourcedomain "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/revocation"
	transport "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/transport/admission"
	"github.com/google/uuid"
)

type registrationSpy struct {
	inner *domain.Service
	calls atomic.Int64
}

func (s *registrationSpy) RegisterInstance(ctx context.Context, id string) (*domain.Instance, error) {
	s.calls.Add(1)
	return s.inner.RegisterInstance(ctx, id)
}
func registrationTLSConfig(t *testing.T, ca receiverCA) app.InternalAdmissionRegistrationConfig {
	t.Helper()
	_, cert, key := receiverLeaf(t, ca, nil, true, false, false)
	dir := t.TempDir()
	cfg := app.InternalAdmissionRegistrationConfig{Enabled: true, Address: "127.0.0.1:0", TLSCertFile: filepath.Join(dir, "server.crt"), TLSKeyFile: filepath.Join(dir, "server.key"), ClientCAFile: filepath.Join(dir, "ca.crt")}
	for path, data := range map[string][]byte{cfg.TLSCertFile: cert, cfg.TLSKeyFile: key, cfg.ClientCAFile: ca.pem} {
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return cfg
}
func registrationHTTPS(t *testing.T, cfg app.InternalAdmissionRegistrationConfig, logger *slog.Logger, service transport.Service) (string, func()) {
	t.Helper()
	server, err := app.NewInternalAdmissionRegistrationServer(cfg, logger, service)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() { result <- server.ServeTLS(listener, "", ""); close(result) }()
	stopped := atomic.Bool{}
	stop := func() {
		if !stopped.CompareAndSwap(false, true) {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			_ = server.Close()
		}
		select {
		case <-result:
		case <-time.After(3 * time.Second):
			t.Error("registration HTTPS shutdown exceeded bound")
		}
	}
	t.Cleanup(stop)
	return "https://" + listener.Addr().String(), stop
}
func registrationHTTPClient(t *testing.T, ca receiverCA, pair *tls.Certificate, version uint16) *http.Client {
	t.Helper()
	roots := x509.NewCertPool()
	roots.AddCert(ca.cert)
	cfg := &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: roots}
	if pair != nil {
		cfg.Certificates = []tls.Certificate{*pair}
	}
	if version != 0 {
		cfg.MinVersion = version
		cfg.MaxVersion = version
	}
	tr := &http.Transport{Proxy: nil, TLSClientConfig: cfg, ForceAttemptHTTP2: false}
	t.Cleanup(tr.CloseIdleConnections)
	return &http.Client{Transport: tr, Timeout: 2 * time.Second}
}
func noUsageRegistrationLeaf(t *testing.T, ca receiverCA) tls.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(ca.key.Curve, rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	uri, _ := url.Parse(transport.CallerURI)
	template := &x509.Certificate{SerialNumber: big.NewInt(time.Now().UnixNano()), NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, URIs: []*url.URL{uri}}
	der, err := x509.CreateCertificate(rand.Reader, template, ca.cert, &key.PublicKey, ca.key)
	if err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}
func TestAdmissionRegistrationActualTLSIdentityAndDurableReplay(t *testing.T) {
	db := registrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	spy := &registrationSpy{inner: domain.NewService(NewRegistrationStore(db))}
	ca := newReceiverCA(t)
	otherCA := newReceiverCA(t)
	cfg := registrationTLSConfig(t, ca)
	logs := &receiverLog{}
	logger := slog.New(slog.NewTextHandler(logs, nil))
	address, stop := registrationHTTPS(t, cfg, logger, spy)
	valid, _, _ := receiverLeaf(t, ca, []string{transport.CallerURI}, false, false, false)
	nonce := uuid.NewString()
	httpClient := registrationHTTPClient(t, ca, &valid, 0)
	loss := &lostReceiverResponse{inner: httpClient.Transport}
	loss.drop.Store(true)
	lost := rc.NewAdmissionRegistrationServiceClient(&http.Client{Transport: loss, Timeout: 2 * time.Second}, address)
	if _, err := lost.RegisterInstance(ctx, connect.NewRequest(&pb.RegisterInstanceRequest{RequestId: nonce})); err == nil {
		t.Fatal("owned response-loss fixture did not fail")
	}
	leafHash := sha256.Sum256(valid.Certificate[0])
	var instance uuid.UUID
	var fence int64
	if err := db.QueryRow(ctx, "SELECT instance_id,registration_fence FROM rtc_admission_instances WHERE leaf_fingerprint=$1 AND request_id=$2", leafHash[:], nonce).Scan(&instance, &fence); err != nil || fence != 1 {
		t.Fatal("lost response did not persist actual verified leaf")
	}
	stop()
	address, _ = registrationHTTPS(t, cfg, logger, &registrationSpy{inner: domain.NewService(NewRegistrationStore(db))})
	client := rc.NewAdmissionRegistrationServiceClient(registrationHTTPClient(t, ca, &valid, 0), address)
	response, err := client.RegisterInstance(ctx, connect.NewRequest(&pb.RegisterInstanceRequest{RequestId: nonce}))
	if err != nil || response.Msg.Instance.InstanceId != instance.String() || response.Msg.Instance.RegistrationFence != fence {
		t.Fatal("server restart replay reallocated")
	}
	if _, err := client.RegisterInstance(ctx, connect.NewRequest(&pb.RegisterInstanceRequest{RequestId: uuid.NewString()})); connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatal("same leaf different nonce accepted")
	}
	// Вторая certificate identity с тем же URI/request не получает старую запись.
	another, _, _ := receiverLeaf(t, ca, []string{transport.CallerURI}, false, false, false)
	anotherClient := rc.NewAdmissionRegistrationServiceClient(registrationHTTPClient(t, ca, &another, 0), address)
	second, err := anotherClient.RegisterInstance(ctx, connect.NewRequest(&pb.RegisterInstanceRequest{RequestId: nonce}))
	if err != nil || second.Msg.Instance.InstanceId == instance.String() || second.Msg.Instance.RegistrationFence != 2 {
		t.Fatal("other leaf inherited predecessor instance")
	}
	for _, state := range []string{"draining", "retired"} {
		if _, err := db.Exec(ctx, "UPDATE rtc_admission_instances SET state=$2 WHERE leaf_fingerprint=$1", leafHash[:], state); err != nil {
			t.Fatal(err)
		}
		got, err := client.RegisterInstance(ctx, connect.NewRequest(&pb.RegisterInstanceRequest{RequestId: nonce}))
		if err != nil || got.Msg.Instance.InstanceId != instance.String() {
			t.Fatal("inactive replay failed")
		}
		expected := pb.AdmissionInstanceState_ADMISSION_INSTANCE_STATE_DRAINING
		if state == "retired" {
			expected = pb.AdmissionInstanceState_ADMISSION_INSTANCE_STATE_RETIRED
		}
		if got.Msg.Instance.State != expected {
			t.Fatal("inactive replay reactivated")
		}
	}
	// Негативы измеряют реальные TLS calls, не fabricated unit context.
	spy2 := &registrationSpy{inner: domain.NewService(NewRegistrationStore(db))}
	negativeAddress, _ := registrationHTTPS(t, cfg, logger, spy2)
	wrongURI, _, _ := receiverLeaf(t, ca, []string{"urn:aerochat:service:rtc-control"}, false, false, false)
	identityURI, _, _ := receiverLeaf(t, ca, []string{"urn:aerochat:service:identity"}, false, false, false)
	chatURI, _, _ := receiverLeaf(t, ca, []string{"urn:aerochat:service:chat"}, false, false, false)
	ambiguous, _, _ := receiverLeaf(t, ca, []string{transport.CallerURI, "urn:aerochat:service:chat"}, false, false, false)
	expired, _, _ := receiverLeaf(t, ca, []string{transport.CallerURI}, false, true, false)
	wrongUsage, _, _ := receiverLeaf(t, ca, []string{transport.CallerURI}, false, false, true)
	wrongCA, _, _ := receiverLeaf(t, otherCA, []string{transport.CallerURI}, false, false, false)
	noUsage := noUsageRegistrationLeaf(t, ca)
	for _, scenario := range []struct {
		name    string
		pair    *tls.Certificate
		version uint16
	}{
		{"absent", nil, 0}, {"wrong_ca", &wrongCA, 0}, {"wrong_uri", &wrongURI, 0}, {"identity_uri", &identityURI, 0}, {"chat_uri", &chatURI, 0}, {"ambiguous", &ambiguous, 0}, {"expired", &expired, 0}, {"wrong_eku", &wrongUsage, 0}, {"no_explicit_client_auth", &noUsage, 0}, {"TLS12", &valid, tls.VersionTLS12},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			before := spy2.calls.Load()
			bad := rc.NewAdmissionRegistrationServiceClient(registrationHTTPClient(t, ca, scenario.pair, scenario.version), negativeAddress)
			request := connect.NewRequest(&pb.RegisterInstanceRequest{RequestId: uuid.NewString()})
			request.Header().Set("X-Aero-Caller", transport.CallerURI)
			request.Header().Set("Authorization", "Bearer owned-marker")
			if _, err := bad.RegisterInstance(ctx, request); err == nil || spy2.calls.Load() != before {
				t.Fatal("TLS negative reached registration domain")
			}
		})
	}
	for _, path := range []string{rc.AdmissionRegistrationServiceRegisterInstanceProcedure, "/aerochat.rtc.revocation.v1.SourceRevocationService/ApplyIdentityEvent", "/aerochat.rtc.revocation.v1.SourceRevocationService/GetChatEventReceipt"} {
		raw := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader("{}"))
		request.Header.Set("X-Aero-Caller", transport.CallerURI)
		transport.NewHTTPHandler(logger, spy2).ServeHTTP(raw, request)
		if raw.Code != 403 {
			t.Fatal("raw HTTP registration bypass")
		}
		pub := httptest.NewRecorder()
		app.NewHTTPHandler(logger, observability.ServiceMeta{}, nil, &rtcv1connect.UnimplementedRtcControlServiceHandler{}).ServeHTTP(pub, request)
		if pub.Code != 404 {
			t.Fatal("private registration path public")
		}
	}
	before := spy2.calls.Load()
	for _, path := range []string{"/aerochat.rtc.revocation.v1.SourceRevocationService/ApplyIdentityEvent", "/aerochat.rtc.revocation.v1.SourceRevocationService/ApplyChatEvent", "/aerochat.rtc.revocation.v1.SourceRevocationService/GetIdentityEventReceipt", "/aerochat.rtc.revocation.v1.SourceRevocationService/GetChatEventReceipt"} {
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, negativeAddress+path, strings.NewReader("{}"))
		if err != nil {
			t.Fatal(err)
		}
		result, err := registrationHTTPClient(t, ca, &valid, 0).Do(request)
		if err != nil {
			t.Fatal("valid certificate could not test method ACL")
		}
		_, _ = io.Copy(io.Discard, result.Body)
		_ = result.Body.Close()
		if result.StatusCode != 403 {
			t.Fatal("source method allowed on registration listener")
		}
	}
	if spy2.calls.Load() != before {
		t.Fatal("wrong method reached domain")
	}
	large := rc.NewAdmissionRegistrationServiceClient(registrationHTTPClient(t, ca, &valid, 0), negativeAddress)
	if _, err := large.RegisterInstance(ctx, connect.NewRequest(&pb.RegisterInstanceRequest{RequestId: strings.Repeat("x", 5000)})); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatal("registration body limit missing")
	}
	overrideLeaf, _, _ := receiverLeaf(t, ca, []string{transport.CallerURI}, false, false, false)
	overrideNonce := uuid.NewString()
	spoofInstance := uuid.NewString()
	body, err := json.Marshal(map[string]any{"requestId": overrideNonce, "instanceId": spoofInstance, "registrationFence": 777, "leafFingerprint": "caller-selected"})
	if err != nil {
		t.Fatal(err)
	}
	overrideRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, negativeAddress+rc.AdmissionRegistrationServiceRegisterInstanceProcedure, strings.NewReader(string(body)))
	if err != nil {
		t.Fatal(err)
	}
	overrideRequest.Header.Set("Content-Type", "application/json")
	overrideRequest.Header.Set("Connect-Protocol-Version", "1")
	overrideRequest.Header.Set("X-Leaf-Fingerprint", "caller-selected")
	overrideRequest.Header.Set("X-Registration-Fence", "777")
	overrideResponse, err := registrationHTTPClient(t, ca, &overrideLeaf, 0).Do(overrideRequest)
	if err != nil {
		t.Fatal("owned override request transport failed")
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(overrideResponse.Body, 8192))
	_ = overrideResponse.Body.Close()
	// Decoder может отвергнуть unknown fields; ни один из них не authority input.
	overrideClient := rc.NewAdmissionRegistrationServiceClient(registrationHTTPClient(t, ca, &overrideLeaf, 0), negativeAddress)
	assigned, err := overrideClient.RegisterInstance(ctx, connect.NewRequest(&pb.RegisterInstanceRequest{RequestId: overrideNonce}))
	if err != nil || assigned.Msg.Instance.InstanceId == spoofInstance || assigned.Msg.Instance.RegistrationFence != 3 {
		t.Fatal("body/header selected registration authority")
	}
	overrideHash := sha256.Sum256(overrideLeaf.Certificate[0])
	var mapped uuid.UUID
	if err := db.QueryRow(ctx, "SELECT instance_id FROM rtc_admission_instances WHERE leaf_fingerprint=$1 AND request_id=$2", overrideHash[:], overrideNonce).Scan(&mapped); err != nil || mapped.String() != assigned.Msg.Instance.InstanceId {
		t.Fatal("fingerprint was not actual verified DER")
	}
	if strings.Contains(logs.String(), nonce) || strings.Contains(logs.String(), instance.String()) || strings.Contains(logs.String(), "owned-marker") || strings.Contains(logs.String(), "PRIVATE KEY") {
		t.Fatal("registration logs exposed payload")
	}
}

func TestAdmissionRegistrationActualTLSDeadlineAndCancellation(t *testing.T) {
	for _, mode := range []string{"deadline", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			db := registrationDatabase(t)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			actor, pid := registrationActor(t, ctx, db, "registration_"+mode)
			ca := newReceiverCA(t)
			cfg := registrationTLSConfig(t, ca)
			address, _ := registrationHTTPS(t, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), domain.NewService(NewRegistrationStore(actor)))
			leaf, _, _ := receiverLeaf(t, ca, []string{transport.CallerURI}, false, false, false)
			client := rc.NewAdmissionRegistrationServiceClient(registrationHTTPClient(t, ca, &leaf, 0), address)
			lock, err := db.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				cleanup, done := context.WithTimeout(context.Background(), 3*time.Second)
				defer done()
				_ = lock.Rollback(cleanup)
			}()
			if _, err := lock.Exec(ctx, "SELECT last_fence FROM rtc_admission_fence FOR UPDATE"); err != nil {
				t.Fatal(err)
			}
			var locker int32
			if err := lock.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&locker); err != nil {
				t.Fatal(err)
			}
			nonce := uuid.NewString()
			requestContext, stop := context.WithTimeout(ctx, 600*time.Millisecond)
			defer stop()
			result := make(chan error, 1)
			started := time.Now()
			go func() {
				_, err := client.RegisterInstance(requestContext, connect.NewRequest(&pb.RegisterInstanceRequest{RequestId: nonce}))
				result <- err
			}()
			registrationWait(t, ctx, db, locker, pid)
			if mode == "cancel" {
				stop()
			}
			select {
			case err := <-result:
				if err == nil || time.Since(started) > 2*time.Second {
					t.Fatal("bounded blocked request not canceled")
				}
			case <-time.After(2 * time.Second):
				t.Fatal("blocked registration exceeded deadline")
			}
			if err := lock.Rollback(ctx); err != nil {
				t.Fatal(err)
			}
			var fence int64
			var count int
			if err := db.QueryRow(ctx, "SELECT last_fence FROM rtc_admission_fence").Scan(&fence); err != nil || fence != 0 {
				t.Fatal("canceled request allocated fence")
			}
			if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM rtc_admission_instances").Scan(&count); err != nil || count != 0 {
				t.Fatal("canceled request persisted instance")
			}
			if _, err := client.RegisterInstance(ctx, connect.NewRequest(&pb.RegisterInstanceRequest{RequestId: nonce})); err != nil {
				t.Fatal("fresh request did not recover")
			}
		})
	}
}

func TestAdmissionRegistrationEnabledWrapperCoupledShutdown(t *testing.T) {
	db := registrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	actor, pid := registrationActor(t, ctx, db, "wrapper")
	ca := newReceiverCA(t)
	cfg := registrationTLSConfig(t, ca)
	logs := &receiverLog{}
	logger := slog.New(slog.NewTextHandler(logs, nil))
	ports := make([]net.Listener, 3)
	for i := range ports {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			for _, l := range ports {
				if l != nil {
					_ = l.Close()
				}
			}
			t.Fatal(err)
		}
		ports[i] = listener
	}
	publicAddress, sourceAddress, registrationAddress := ports[0].Addr().String(), ports[1].Addr().String(), ports[2].Addr().String()
	for _, l := range ports {
		_ = l.Close()
	}
	cfg.Address = registrationAddress
	sourceCfg := app.InternalRevocationConfig{Enabled: true, Address: sourceAddress, TLSCertFile: cfg.TLSCertFile, TLSKeyFile: cfg.TLSKeyFile, ClientCAFile: cfg.ClientCAFile}
	source := &receiverSpy{inner: sourcedomain.NewService(NewMediaStore(db))}
	child, stop := context.WithCancel(ctx)
	defer stop()
	done := make(chan error, 1)
	go func() {
		done <- app.RunHTTPServersWithRegistration(child, logger, observability.HTTPServerConfig{Address: publicAddress, ShutdownTimeout: time.Second}, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) }), sourceCfg, source, cfg, domain.NewService(NewRegistrationStore(actor)))
		close(done)
	}()
	finished := atomic.Bool{}
	waitStopped := func() {
		if !finished.CompareAndSwap(false, true) {
			return
		}
		stop()
		select {
		case err := <-done:
			if err != nil && !errors.Is(err, context.Canceled) {
				t.Error("coupled server shutdown failed")
			}
		case <-time.After(3 * time.Second):
			t.Error("coupled server shutdown exceeded bound")
		}
	}
	t.Cleanup(waitStopped)
	pubTransport := &http.Transport{Proxy: nil}
	pubClient := &http.Client{Transport: pubTransport, Timeout: 200 * time.Millisecond}
	defer pubTransport.CloseIdleConnections()
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		response, err := pubClient.Get("http://" + publicAddress + "/")
		if err == nil {
			_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
			_ = response.Body.Close()
			if response.StatusCode == 200 {
				break
			}
		}
		select {
		case <-deadline.C:
			t.Fatal("public server not started")
		case <-ticker.C:
		}
	}
	identity, _, _ := receiverLeaf(t, ca, []string{"urn:aerochat:service:identity"}, false, false, false)
	sourceClient := receiverClient(t, "https://"+sourceAddress, ca, &identity, 0)
	if _, err := sourceClient.GetIdentityEventReceipt(ctx, connect.NewRequest(&sourcepb.GetIdentityEventReceiptRequest{EventId: uuid.NewString()})); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatal("source private server not active")
	}
	lock, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = lock.Rollback(cleanup)
	}()
	if _, err := lock.Exec(ctx, "SELECT last_fence FROM rtc_admission_fence FOR UPDATE"); err != nil {
		t.Fatal(err)
	}
	var locker int32
	if err := lock.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&locker); err != nil {
		t.Fatal(err)
	}
	leaf, _, _ := receiverLeaf(t, ca, []string{transport.CallerURI}, false, false, false)
	client := rc.NewAdmissionRegistrationServiceClient(registrationHTTPClient(t, ca, &leaf, 0), "https://"+registrationAddress)
	requestDone := make(chan error, 1)
	go func() {
		_, err := client.RegisterInstance(ctx, connect.NewRequest(&pb.RegisterInstanceRequest{RequestId: uuid.NewString()}))
		requestDone <- err
	}()
	registrationWait(t, ctx, db, locker, pid)
	stop()
	waitStopped()
	select {
	case err := <-requestDone:
		if err == nil {
			t.Fatal("shutdown completed blocked registration")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("blocked registration survived shutdown")
	}
	for _, address := range []string{publicAddress, sourceAddress, registrationAddress} {
		connection, err := net.DialTimeout("tcp", address, 200*time.Millisecond)
		if err == nil {
			_ = connection.Close()
			t.Fatal("coupled listener survived cancellation")
		}
	}
	if err := lock.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	var fence int64
	var count int
	if err := db.QueryRow(ctx, "SELECT last_fence FROM rtc_admission_fence").Scan(&fence); err != nil || fence != 0 {
		t.Fatal("shutdown mutated global fence")
	}
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM rtc_admission_instances").Scan(&count); err != nil || count != 0 {
		t.Fatal("shutdown fabricated registration")
	}
}
