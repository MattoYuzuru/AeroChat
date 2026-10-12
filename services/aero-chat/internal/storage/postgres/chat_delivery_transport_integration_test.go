//go:build integration

package postgres

import (
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"debug/buildinfo"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"io"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/MattoYuzuru/AeroChat/libs/go/dbbootstrap"
	chatschema "github.com/MattoYuzuru/AeroChat/services/aero-chat/db/schema"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/app"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/delivery"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/transport/rtcrevocation"
	identityschema "github.com/MattoYuzuru/AeroChat/services/aero-identity/db/schema"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type chatSenderMaterial struct{ serverCert, serverKey, caFile, clientCert, clientKey string }

func chatSenderTLSMaterial(t *testing.T) chatSenderMaterial {
	t.Helper()
	issuer := privateGroupIssuer(t)
	_, serverCert, serverKey := privateGroupCertificate(t, issuer, nil, true, false)
	_, clientCert, clientKey := privateGroupCertificate(t, issuer, []string{"urn:aerochat:service:chat"}, false, false)
	dir := t.TempDir()
	m := chatSenderMaterial{serverCert: filepath.Join(dir, "server.crt"), serverKey: filepath.Join(dir, "server.key"), caFile: filepath.Join(dir, "ca.crt"), clientCert: filepath.Join(dir, "client.crt"), clientKey: filepath.Join(dir, "client.key")}
	for path, data := range map[string][]byte{m.serverCert: serverCert, m.serverKey: serverKey, m.caFile: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: issuer.der}), m.clientCert: clientCert, m.clientKey: clientKey} {
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return m
}
func chatSenderReceiverDB(t *testing.T, ctx context.Context) (*pgxpool.Pool, string) {
	t.Helper()
	data, err := os.ReadFile(os.Getenv("AERO_RTC_TEST_DATABASE_ENV_FILE"))
	if err != nil {
		t.Fatal("owned RTC profile required")
	}
	dsn := ""
	for _, line := range strings.Split(string(data), string(rune(10))) {
		if value, ok := strings.CutPrefix(line, "AERO_DATABASE_URL="); ok {
			dsn = strings.TrimSpace(value)
		}
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil || cfg.ConnConfig.Database != "aerochat_rtc_test" || cfg.ConnConfig.Port != 25432 || (cfg.ConnConfig.Host != "localhost" && cfg.ConnConfig.Host != "127.0.0.1") {
		t.Fatal("dedicated owned RTC database required")
	}
	admin, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal("owned RTC admin connection failed")
	}
	t.Cleanup(admin.Close)
	name := "rtc_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	quoted := pgx.Identifier{name}.Sanitize()
	var exists bool
	if err := admin.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1)", name).Scan(&exists); err != nil || exists {
		t.Fatal("new RTC schema must be absent")
	}
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal("cannot create own RTC schema")
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := admin.Exec(cleanup, "DROP SCHEMA "+quoted+" CASCADE"); err != nil {
			t.Error("own RTC cleanup failed")
		}
	})
	cfg.ConnConfig.RuntimeParams["search_path"] = name
	cfg.ConnConfig.RuntimeParams["application_name"] = name
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal("own RTC pool failed")
	}
	t.Cleanup(db.Close)
	// Штатный запуск RTC проверяет реальные реестры миграций зависимых сервисов.
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := dbbootstrap.Apply(ctx, db, dbbootstrap.Options{ServiceName: "aero-identity", Files: identityschema.Files, Logger: logger}); err != nil {
		t.Fatal("owned Identity prerequisite bootstrap failed")
	}
	if err := dbbootstrap.Apply(ctx, db, dbbootstrap.Options{ServiceName: "aero-chat", Files: chatschema.Files, Logger: logger}); err != nil {
		t.Fatal("owned Chat prerequisite bootstrap failed")
	}
	return db, cfg.ConnConfig.ConnString()
}

type chatSenderProcess struct {
	url  string
	stop func()
	logs *privateGroupLogs
}

func chatSenderReceiverProcess(t *testing.T, dsn string, m chatSenderMaterial) *chatSenderProcess {
	t.Helper()
	binary := os.Getenv("AERO_RTC_RECEIVER_TEST_BINARY")
	head := os.Getenv("AERO_RTC_RECEIVER_TEST_HEAD")
	content, err := os.ReadFile(binary)
	if err != nil {
		t.Fatal("fresh exact-source RTC binary required")
	}
	sum := sha256.Sum256(content)
	if hex.EncodeToString(sum[:]) != os.Getenv("AERO_RTC_RECEIVER_TEST_BINARY_SHA256") || head == "" {
		t.Fatal("RTC binary hash/head missing")
	}
	info, err := buildinfo.ReadFile(binary)
	if err != nil || info.Path != "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/cmd/aero-rtc-control" {
		t.Fatal("unexpected RTC executable")
	}
	revision, modified := "", ""
	for _, s := range info.Settings {
		if s.Key == "vcs.revision" {
			revision = s.Value
		}
		if s.Key == "vcs.modified" {
			modified = s.Value
		}
	}
	if revision != head || modified != "false" {
		t.Fatal("RTC binary source drift")
	}
	ports := make([]net.Listener, 2)
	for i := range ports {
		ports[i], err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			for _, port := range ports {
				if port != nil {
					_ = port.Close()
				}
			}
			t.Fatal(err)
		}
	}
	public, private := ports[0].Addr().String(), ports[1].Addr().String()
	for _, port := range ports {
		_ = port.Close()
	}
	logs := &privateGroupLogs{}
	cmd := exec.Command(binary)
	// Child наследует owned gate process group; helper останавливает только свой PID.
	cmd.Env = []string{"LANG=C.UTF-8", "AERO_DATABASE_URL=" + dsn, "AERO_HTTP_ADDR=" + public, "AERO_LOG_LEVEL=debug", "AERO_SHUTDOWN_TIMEOUT=1s", "AERO_DATABASE_BOOTSTRAP_TIMEOUT=3s", "AERO_IDENTITY_URL=http://" + public, "AERO_CHAT_URL=http://" + public, "AERO_RTC_INTERNAL_REVOCATION_ENABLED=true", "AERO_RTC_INTERNAL_REVOCATION_LISTEN_ADDR=" + private, "AERO_RTC_INTERNAL_REVOCATION_TLS_CERT_FILE=" + m.serverCert, "AERO_RTC_INTERNAL_REVOCATION_TLS_KEY_FILE=" + m.serverKey, "AERO_RTC_INTERNAL_REVOCATION_CLIENT_CA_FILE=" + m.caFile}
	cmd.Stdout = logs
	cmd.Stderr = logs
	if err := cmd.Start(); err != nil {
		t.Fatal("owned RTC process start failed")
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait(); close(done) }()
	var once sync.Once
	stop := func() {
		once.Do(func() {
			select {
			case <-done:
				return
			default:
			}
			_ = cmd.Process.Signal(syscall.SIGTERM)
			select {
			case <-done:
				return
			case <-time.After(3 * time.Second):
			}
			_ = cmd.Process.Kill()
			select {
			case <-done:
			case <-time.After(3 * time.Second):
				t.Error("own RTC PID cleanup exceeded bound")
			}
		})
	}
	t.Cleanup(stop)
	transport := &http.Transport{Proxy: nil}
	client := &http.Client{Transport: transport, Timeout: 200 * time.Millisecond}
	defer transport.CloseIdleConnections()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		response, err := client.Get("http://" + public + "/healthz")
		if err == nil {
			_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
			_ = response.Body.Close()
			if response.StatusCode == 200 {
				return &chatSenderProcess{url: "https://" + private, stop: stop, logs: logs}
			}
		}
		select {
		case <-done:
			t.Fatal("own RTC process exited before liveness")
		case <-deadline.C:
			t.Fatal("own RTC process startup deadline")
		case <-ticker.C:
		}
	}
}
func chatSenderClientConfig(p *chatSenderProcess, m chatSenderMaterial) rtcrevocation.Config {
	return rtcrevocation.Config{Enabled: true, BaseURL: p.url, ServerCAFile: m.caFile, TLSCertFile: m.clientCert, TLSKeyFile: m.clientKey}
}

type countedChatDeliveryClient struct {
	client        *rtcrevocation.Client
	apply, lookup int
}

func (c *countedChatDeliveryClient) Apply(ctx context.Context, e delivery.Event) (delivery.Receipt, error) {
	c.apply++
	return c.client.Apply(ctx, e)
}
func (c *countedChatDeliveryClient) Lookup(ctx context.Context, id uuid.UUID) (delivery.Receipt, error) {
	c.lookup++
	return c.client.Lookup(ctx, id)
}
func TestChatSenderActualTLSCommitCrashAndCanonicalConflict(t *testing.T) {
	source, ctx := groupAuthorityDatabase(t, false)
	receiver, dsn := chatSenderReceiverDB(t, ctx)
	material := chatSenderTLSMaterial(t)
	process := chatSenderReceiverProcess(t, dsn, material)
	logs := []*privateGroupLogs{process.logs}
	cfg := chatSenderClientConfig(process, material)
	client, err := rtcrevocation.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	event := chatDeliveryEvent(t, ctx, source)
	groupAuthorityExec(t, ctx, source, "CREATE FUNCTION reject_chat_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='delivered' THEN RAISE EXCEPTION 'owned receipt fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_chat_receipt BEFORE UPDATE ON chat_revocation_delivery FOR EACH ROW EXECUTE FUNCTION reject_chat_receipt()")
	repo := NewDeliveryRepository(source)
	counted := &countedChatDeliveryClient{client: client}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := delivery.NewWorker(repo, counted, logger).Step(ctx); !errors.Is(err, delivery.ErrUnavailable) {
		t.Fatal("actual receipt CAS fault not preserved")
	}
	var operation uuid.UUID
	var epoch int64
	if err := receiver.QueryRow(ctx, "SELECT operation_id,source_revision FROM rtc_media_source_inbox WHERE origin_domain='chat' AND event_id=$1", event).Scan(&operation, &epoch); err != nil || operation == uuid.Nil || epoch != 2 {
		t.Fatal("committed source event did not reach production receiver")
	}
	var count int
	if err := source.QueryRow(ctx, "SELECT COUNT(*) FROM chat_revocation_delivery WHERE event_id=$1 AND state='pending' AND attempt=1 AND claim_fence=1 AND operation_id IS NULL", event).Scan(&count); err != nil || count != 1 {
		t.Fatal("CAS fault falsely completed delivery")
	}
	process.stop()
	client.Close()
	process = chatSenderReceiverProcess(t, dsn, material)
	logs = append(logs, process.logs)
	cfg = chatSenderClientConfig(process, material)
	client, err = rtcrevocation.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	counted.client = client
	groupAuthorityExec(t, ctx, source, "DROP TRIGGER reject_chat_receipt ON chat_revocation_delivery")
	groupAuthorityExec(t, ctx, source, "UPDATE chat_revocation_delivery SET claim_until=clock_timestamp()-interval '1 second' WHERE event_id=$1", event)
	if err := delivery.NewWorker(repo, counted, logger).Step(ctx); err != nil {
		t.Fatal("restart/takeover delivery failed")
	}
	if counted.lookup != 1 || counted.apply != 2 {
		t.Fatal("recovery bypassed canonical replay")
	}
	if err := source.QueryRow(ctx, "SELECT COUNT(*) FROM chat_revocation_delivery WHERE event_id=$1 AND state='delivered' AND attempt=2 AND claim_fence=2 AND operation_id=$2 AND registry_media_effect='no_matching_registry_grants'", event, operation).Scan(&count); err != nil || count != 1 {
		t.Fatal("factual receipt mapping differs")
	}
	conflictID := chatDeliveryEvent(t, ctx, source)
	var conflict delivery.Event
	if err := source.QueryRow(ctx, "SELECT event_id,group_id,user_id,source_revision,reason FROM chat_authority_revocation_outbox WHERE event_id=$1", conflictID).Scan(&conflict.ID, &conflict.GroupID, &conflict.UserID, &conflict.Epoch, &conflict.SourceReason); err != nil {
		t.Fatal(err)
	}
	wrongIssuer := privateGroupIssuer(t)
	wrongCA := filepath.Join(t.TempDir(), "wrong-ca.crt")
	if err := os.WriteFile(wrongCA, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: wrongIssuer.der}), 0600); err != nil {
		t.Fatal(err)
	}
	badConfig := cfg
	badConfig.ServerCAFile = wrongCA
	bad, err := rtcrevocation.NewClient(badConfig)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(bad.Close)
	if err := delivery.NewWorker(repo, bad, logger).Step(ctx); !errors.Is(err, delivery.ErrUnavailable) {
		t.Fatal("first actual network failure not preserved")
	}
	if err := receiver.QueryRow(ctx, "SELECT COUNT(*) FROM rtc_media_source_inbox WHERE event_id=$1", conflictID).Scan(&count); err != nil || count != 0 {
		t.Fatal("wrong CA delivered event")
	}
	changed := conflict
	changed.Epoch++
	if _, err := client.Apply(ctx, changed); err != nil {
		t.Fatal("owned conflicting tuple fixture failed")
	}
	groupAuthorityExec(t, ctx, source, "UPDATE chat_revocation_delivery SET next_attempt_at=clock_timestamp() WHERE event_id=$1", conflictID)
	recovered := &countedChatDeliveryClient{client: client}
	if err := delivery.NewWorker(repo, recovered, logger).Step(ctx); err != nil {
		t.Fatal("canonical conflict quarantine failed")
	}
	if recovered.lookup != 1 || recovered.apply != 1 {
		t.Fatal("event-only lookup hid canonical conflict")
	}
	if err := source.QueryRow(ctx, "SELECT COUNT(*) FROM chat_revocation_delivery WHERE event_id=$1 AND state='quarantined' AND quarantine_reason='canonical_conflict' AND operation_id IS NULL", conflictID).Scan(&count); err != nil || count != 1 {
		t.Fatal("conflicting tuple falsely delivered")
	}
	for _, log := range logs {
		for _, marker := range []string{event.String(), conflictID.String(), conflict.GroupID.String(), conflict.UserID.String(), "PRIVATE KEY"} {
			if strings.Contains(log.text(), marker) {
				t.Fatal("private receiver logs exposed payload")
			}
		}
	}
}

func TestChatSenderEnabledWrapperCancelsClaimAndRecovers(t *testing.T) {
	source, ctx := groupAuthorityDatabase(t, false)
	receiver, dsn := chatSenderReceiverDB(t, ctx)
	material := chatSenderTLSMaterial(t)
	process := chatSenderReceiverProcess(t, dsn, material)
	event := chatDeliveryEvent(t, ctx, source)
	actor, pid := chatDeliveryActor(t, ctx, source, "wrapper")
	lock, err := source.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = lock.Rollback(cleanup)
	}()
	var lockerPID int32
	if err := lock.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&lockerPID); err != nil {
		t.Fatal(err)
	}
	barrier := time.Now().UnixNano()
	if _, err := lock.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", barrier); err != nil {
		t.Fatal(err)
	}
	groupAuthorityExec(t, ctx, source, "CREATE FUNCTION block_chat_wrapper_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock("+strconv.FormatInt(barrier, 10)+"); RETURN NEW; END $$; CREATE TRIGGER block_chat_wrapper_claim BEFORE UPDATE ON chat_revocation_delivery FOR EACH ROW EXECUTE FUNCTION block_chat_wrapper_claim()")
	port, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := port.Addr().String()
	_ = port.Close()
	cfg := app.Config{HTTPAddress: address, ShutdownTimeout: time.Second, RevocationDelivery: chatSenderClientConfig(process, material)}
	logs := &privateGroupLogs{}
	logger := slog.New(slog.NewTextHandler(logs, nil))
	child, cancel := context.WithCancel(ctx)
	defer cancel()
	result := make(chan error, 1)
	go func() {
		result <- app.RunServersWithSourceDelivery(child, logger, cfg, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) }), nil, NewDeliveryRepository(actor))
		close(result)
	}()
	var once sync.Once
	stop := func() {
		once.Do(func() {
			cancel()
			select {
			case err := <-result:
				if err != nil && !errors.Is(err, context.Canceled) {
					t.Error("Chat wrapper/worker shutdown failed")
				}
			case <-time.After(3 * time.Second):
				t.Error("Chat wrapper/worker shutdown exceeded bound")
			}
		})
	}
	t.Cleanup(stop)
	transport := &http.Transport{Proxy: nil}
	httpClient := &http.Client{Transport: transport, Timeout: 200 * time.Millisecond}
	defer transport.CloseIdleConnections()
	ready, blocked := false, false
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if !ready {
			response, err := httpClient.Get("http://" + address + "/")
			if err == nil {
				_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
				_ = response.Body.Close()
				ready = response.StatusCode == 200
			}
		}
		if err := source.QueryRow(ctx, "SELECT $1=ANY(pg_blocking_pids($2)) AND position('-- name: ClaimChatAuthorityDelivery' in query)>0 FROM pg_stat_activity WHERE pid=$2", lockerPID, pid).Scan(&blocked); err != nil {
			t.Fatal("cannot observe specific Chat Claim barrier")
		}
		if ready && blocked {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("wrapper observation canceled")
		case <-time.After(10 * time.Millisecond):
		}
	}
	if !ready || !blocked {
		t.Fatal("enabled production HTTP/Worker.Run not observed")
	}
	cancel()
	stop()
	response, err := httpClient.Get("http://" + address + "/")
	if err == nil {
		_ = response.Body.Close()
		t.Fatal("public HTTP survived cancellation")
	}
	var count int
	if err := source.QueryRow(ctx, "SELECT COUNT(*) FROM chat_revocation_delivery WHERE event_id=$1 AND state='pending' AND attempt=0 AND claim_fence=0 AND claim_owner IS NULL AND operation_id IS NULL", event).Scan(&count); err != nil || count != 1 {
		t.Fatal("canceled claim fabricated delivery")
	}
	if err := receiver.QueryRow(ctx, "SELECT COUNT(*) FROM rtc_media_source_inbox WHERE event_id=$1", event).Scan(&count); err != nil || count != 0 {
		t.Fatal("canceled Claim reached RTC")
	}
	if err := lock.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	groupAuthorityExec(t, ctx, source, "DROP TRIGGER block_chat_wrapper_claim ON chat_revocation_delivery")
	client, err := rtcrevocation.NewClient(cfg.RevocationDelivery)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	if err := delivery.NewWorker(NewDeliveryRepository(actor), client, logger).Step(ctx); err != nil {
		t.Fatal("fresh worker failed after wrapper cancellation")
	}
	if err := source.QueryRow(ctx, "SELECT COUNT(*) FROM chat_revocation_delivery WHERE event_id=$1 AND state='delivered' AND attempt=1 AND claim_fence=1", event).Scan(&count); err != nil || count != 1 {
		t.Fatal("retained source event not delivered")
	}
	if strings.Contains(logs.text()+process.logs.text(), event.String()) {
		t.Fatal("worker/receiver log exposed event")
	}
}

func TestChatSenderClientOwnedTLSBoundary(t *testing.T) {
	issuer := privateGroupIssuer(t)
	serverLeaf, _, _ := privateGroupCertificate(t, issuer, nil, true, false)
	_, clientCert, clientKey := privateGroupCertificate(t, issuer, []string{"urn:aerochat:service:chat"}, false, false)
	dir := t.TempDir()
	caFile, certFile, keyFile := filepath.Join(dir, "ca.crt"), filepath.Join(dir, "client.crt"), filepath.Join(dir, "client.key")
	for path, data := range map[string][]byte{caFile: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: issuer.der}), certFile: clientCert, keyFile: clientKey} {
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	roots := x509.NewCertPool()
	roots.AddCert(issuer.cert)
	var upstreamCalls, targetCalls atomic.Int64
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { targetCalls.Add(1); w.WriteHeader(500) }))
	t.Cleanup(target.Close)
	upstream := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamCalls.Add(1)
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	upstream.TLS = &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{serverLeaf}, ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: roots}
	upstream.StartTLS()
	t.Cleanup(upstream.Close)
	cfg := rtcrevocation.Config{Enabled: true, BaseURL: upstream.URL, ServerCAFile: caFile, TLSCertFile: certFile, TLSKeyFile: keyFile}
	client, err := rtcrevocation.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	event := delivery.Event{ID: uuid.New(), GroupID: uuid.New(), UserID: uuid.New(), Epoch: 2, SourceReason: "member_removed"}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err := client.Apply(ctx, event); !errors.Is(err, delivery.ErrUnavailable) {
		t.Fatal("redirect must fail statically")
	}
	if upstreamCalls.Load() != 1 || targetCalls.Load() != 0 {
		t.Fatal("client escaped configured authority")
	}
	for _, scenario := range []struct {
		name            string
		uris            []string
		server, expired bool
	}{
		{"wrong_uri", []string{"urn:aerochat:service:identity"}, false, false},
		{"ambiguous", []string{"urn:aerochat:service:chat", "urn:aerochat:service:identity"}, false, false},
		{"wrong_eku", []string{"urn:aerochat:service:chat"}, true, false},
		{"expired", []string{"urn:aerochat:service:chat"}, false, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			_, cert, key := privateGroupCertificate(t, issuer, scenario.uris, scenario.server, scenario.expired)
			bad := cfg
			temp := t.TempDir()
			bad.TLSCertFile = filepath.Join(temp, "bad.crt")
			bad.TLSKeyFile = filepath.Join(temp, "bad.key")
			if err := os.WriteFile(bad.TLSCertFile, cert, 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(bad.TLSKeyFile, key, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := rtcrevocation.NewClient(bad); err == nil {
				t.Fatal("bad producer identity accepted")
			}
			if upstreamCalls.Load() != 1 {
				t.Fatal("invalid client certificate made HTTP request")
			}
		})
	}
	key := serverLeaf.PrivateKey.(*ecdsa.PrivateKey)
	template := &x509.Certificate{SerialNumber: big.NewInt(42), NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, DNSNames: []string{"invalid.owned.fixture"}}
	der, err := x509.CreateCertificate(rand.Reader, template, issuer.cert, &key.PublicKey, issuer.key)
	if err != nil {
		t.Fatal(err)
	}
	mismatch := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { upstreamCalls.Add(1); w.WriteHeader(500) }))
	mismatch.TLS = &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}}
	mismatch.StartTLS()
	t.Cleanup(mismatch.Close)
	bad := cfg
	bad.BaseURL = mismatch.URL
	badClient, err := rtcrevocation.NewClient(bad)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(badClient.Close)
	check, done := context.WithTimeout(context.Background(), time.Second)
	defer done()
	if _, err := badClient.Apply(check, event); !errors.Is(err, delivery.ErrUnavailable) || upstreamCalls.Load() != 1 {
		t.Fatal("server SAN mismatch bypassed verification")
	}
}
