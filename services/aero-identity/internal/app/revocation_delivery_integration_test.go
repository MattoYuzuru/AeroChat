//go:build integration

package app

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
	"net/url"
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

	libauth "github.com/MattoYuzuru/AeroChat/libs/go/auth"
	"github.com/MattoYuzuru/AeroChat/libs/go/dbbootstrap"
	chatschema "github.com/MattoYuzuru/AeroChat/services/aero-chat/db/schema"
	identityschema "github.com/MattoYuzuru/AeroChat/services/aero-identity/db/schema"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/domain/delivery"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/domain/identity"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/storage/postgres"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/transport/rtcrevocation"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func senderRTCFixture(t *testing.T, ctx context.Context) (*pgxpool.Pool, string) {
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
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil || config.ConnConfig.Database != "aerochat_rtc_test" || config.ConnConfig.Port != 25432 || (config.ConnConfig.Host != "localhost" && config.ConnConfig.Host != "127.0.0.1") {
		t.Fatal("dedicated owned RTC DB required")
	}
	admin, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal("cannot open owned RTC DB")
	}
	t.Cleanup(admin.Close)
	name := "rtc_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	quoted := pgx.Identifier{name}.Sanitize()
	var exists bool
	if err := admin.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1)", name).Scan(&exists); err != nil || exists {
		t.Fatal("new RTC schema must be absent")
	}
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal("cannot create owned RTC schema")
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := admin.Exec(cleanup, "DROP SCHEMA "+quoted+" CASCADE"); err != nil {
			t.Error("owned RTC schema cleanup failed")
		}
	})
	config.ConnConfig.RuntimeParams["search_path"] = name
	config.ConnConfig.RuntimeParams["application_name"] = name
	db, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal("owned RTC pool unavailable")
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
	// ConnString возвращает исходный DSN без изменённых RuntimeParams.
	// Отдельному процессу передаём те же owned search_path/application_name явно.
	connectionURL, err := url.Parse(dsn)
	if err != nil || (connectionURL.Scheme != "postgres" && connectionURL.Scheme != "postgresql") {
		t.Fatal("owned RTC profile requires PostgreSQL URL")
	}
	query := connectionURL.Query()
	query.Set("search_path", name)
	query.Set("application_name", name)
	connectionURL.RawQuery = query.Encode()
	receiverDSN := connectionURL.String()
	receiverConfig, err := pgxpool.ParseConfig(receiverDSN)
	if err != nil || receiverConfig.ConnConfig.RuntimeParams["search_path"] != name || receiverConfig.ConnConfig.RuntimeParams["application_name"] != name {
		t.Fatal("native receiver schema binding missing")
	}
	return db, receiverDSN
}
func senderCertificateFiles(t *testing.T, leaf tls.Certificate) (string, string) {
	t.Helper()
	key, err := x509.MarshalPKCS8PrivateKey(leaf.PrivateKey)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	certFile, keyFile := filepath.Join(dir, "client.crt"), filepath.Join(dir, "client.key")
	for path, data := range map[string][]byte{certFile: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leaf.Certificate[0]}), keyFile: pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: key})} {
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return certFile, keyFile
}

type receiverProcess struct {
	baseURL string
	stop    func()
	logs    *authorityLogBuffer
}

func senderReceiverProcess(t *testing.T, dsn string, cfg InternalAuthorizationConfig) *receiverProcess {
	t.Helper()
	binary := os.Getenv("AERO_RTC_RECEIVER_TEST_BINARY")
	expected := os.Getenv("AERO_RTC_RECEIVER_TEST_HEAD")
	bytes, err := os.ReadFile(binary)
	if err != nil {
		t.Fatal("fresh exact-source RTC binary required")
	}
	sum := sha256.Sum256(bytes)
	if hex.EncodeToString(sum[:]) != os.Getenv("AERO_RTC_RECEIVER_TEST_BINARY_SHA256") || expected == "" {
		t.Fatal("RTC binary hash/source receipt missing")
	}
	info, err := buildinfo.ReadFile(binary)
	if err != nil || info.Path != "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/cmd/aero-rtc-control" {
		t.Fatal("unexpected native receiver binary")
	}
	revision, modified := "", ""
	for _, setting := range info.Settings {
		if setting.Key == "vcs.revision" {
			revision = setting.Value
		}
		if setting.Key == "vcs.modified" {
			modified = setting.Value
		}
	}
	if revision != expected || modified != "false" {
		t.Fatal("native receiver binary source drift")
	}
	listeners := make([]net.Listener, 2)
	for i := range listeners {
		listeners[i], err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			for _, l := range listeners {
				if l != nil {
					_ = l.Close()
				}
			}
			t.Fatal(err)
		}
	}
	public, private := listeners[0].Addr().String(), listeners[1].Addr().String()
	for _, l := range listeners {
		_ = l.Close()
	}
	logs := &authorityLogBuffer{}
	cmd := exec.Command(binary)
	// Receiver наследует owned gate process group для аварийного cleanup внешнего driver.
	cmd.Env = []string{"LANG=C.UTF-8", "AERO_DATABASE_URL=" + dsn, "AERO_HTTP_ADDR=" + public, "AERO_LOG_LEVEL=debug", "AERO_SHUTDOWN_TIMEOUT=1s", "AERO_DATABASE_BOOTSTRAP_TIMEOUT=3s", "AERO_IDENTITY_URL=http://" + public, "AERO_CHAT_URL=http://" + public, "AERO_RTC_INTERNAL_REVOCATION_ENABLED=true", "AERO_RTC_INTERNAL_REVOCATION_LISTEN_ADDR=" + private, "AERO_RTC_INTERNAL_REVOCATION_TLS_CERT_FILE=" + cfg.TLSCertFile, "AERO_RTC_INTERNAL_REVOCATION_TLS_KEY_FILE=" + cfg.TLSKeyFile, "AERO_RTC_INTERNAL_REVOCATION_CLIENT_CA_FILE=" + cfg.ClientCAFile}
	cmd.Stdout = logs
	cmd.Stderr = logs
	if err := cmd.Start(); err != nil {
		t.Fatal("cannot start owned native receiver")
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
				t.Error("owned receiver process did not stop")
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
				return &receiverProcess{baseURL: "https://" + private, stop: stop, logs: logs}
			}
		}
		select {
		case <-done:
			t.Fatal("owned receiver exited before liveness")
		case <-deadline.C:
			t.Fatal("owned receiver startup deadline")
		case <-ticker.C:
		}
	}
}
func senderAccount(t *testing.T, ctx context.Context, db *pgxpool.Pool) *identity.AuthSession {
	t.Helper()
	user, device, session := uuid.NewString(), uuid.NewString(), uuid.NewString()
	now := time.Now()
	_, hash, err := libauth.NewSessionTokenManager().Issue(session)
	if err != nil {
		t.Fatal(err)
	}
	auth, err := postgres.NewRepository(db).CreateAccount(ctx, identity.CreateAccountParams{User: identity.User{ID: user, Login: "sender." + user[:8], Nickname: "Sender fixture", KeyBackupStatus: identity.KeyBackupStatusNotConfigured, CreatedAt: now, UpdatedAt: now}, Device: identity.Device{ID: device, UserID: user, Label: "Sender fixture", CreatedAt: now, LastSeenAt: now}, Session: identity.Session{ID: session, UserID: user, DeviceID: device, CreatedAt: now, LastSeenAt: now}, PasswordHash: "fixture-unused", TokenHash: hash})
	if err != nil {
		t.Fatal(err)
	}
	return auth
}

type senderCountClient struct {
	client        *rtcrevocation.Client
	apply, lookup int
}

func (c *senderCountClient) Apply(ctx context.Context, e delivery.Event) (delivery.Receipt, error) {
	c.apply++
	return c.client.Apply(ctx, e)
}
func (c *senderCountClient) Lookup(ctx context.Context, id uuid.UUID) (delivery.Receipt, error) {
	c.lookup++
	return c.client.Lookup(ctx, id)
}
func TestIdentitySenderActualTLSCommittedEventAndCrashTakeover(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	source := privateAuthorityDatabase(t, ctx)
	receiver, dsn := senderRTCFixture(t, ctx)
	ca := authorityCA(t)
	serverConfig := authorityTLSConfig(t, ca)
	leaf := authorityLeaf(t, ca, x509.ExtKeyUsageClientAuth, []string{"urn:aerochat:service:identity"}, false)
	cert, key := senderCertificateFiles(t, leaf)
	process := senderReceiverProcess(t, dsn, serverConfig)
	processLogs := []*authorityLogBuffer{process.logs}
	cfg := rtcrevocation.Config{Enabled: true, BaseURL: process.baseURL, ServerCAFile: serverConfig.ClientCAFile, TLSCertFile: cert, TLSKeyFile: key}
	client, err := rtcrevocation.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	auth := senderAccount(t, ctx, source)
	if changed, err := postgres.NewRepository(source).RevokeSession(ctx, auth.User.ID, auth.Session.ID, time.Now()); err != nil || !changed {
		t.Fatal("source commit failed")
	}
	var event uuid.UUID
	if err := source.QueryRow(ctx, "SELECT id FROM identity_authority_revocation_outbox WHERE subject_id=$1 AND subject_kind='session'", auth.Session.ID).Scan(&event); err != nil {
		t.Fatal(err)
	}
	// Fault после actual RTC commit воспроизводит crash boundary до source receipt CAS.
	if _, err := source.Exec(ctx, "CREATE FUNCTION reject_receipt_cas() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='delivered' THEN RAISE EXCEPTION 'owned receipt CAS fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_receipt_cas BEFORE UPDATE ON identity_revocation_delivery FOR EACH ROW EXECUTE FUNCTION reject_receipt_cas()"); err != nil {
		t.Fatal(err)
	}
	repo := postgres.NewDeliveryRepository(source)
	countClient := &senderCountClient{client: client}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := delivery.NewWorker(repo, countClient, logger).Step(ctx); !errors.Is(err, delivery.ErrUnavailable) {
		t.Fatal("actual source CAS fault not preserved")
	}
	var operation uuid.UUID
	var revision int64
	if err := receiver.QueryRow(ctx, "SELECT operation_id,source_revision FROM rtc_media_source_inbox WHERE origin_domain='identity' AND event_id=$1", event).Scan(&operation, &revision); err != nil || operation == uuid.Nil || revision != 2 {
		t.Fatal("committed source canonical event did not reach actual RTC inbox")
	}
	var count int
	if err := source.QueryRow(ctx, "SELECT COUNT(*) FROM identity_revocation_delivery WHERE event_id=$1 AND state='pending' AND attempt=1 AND claim_fence=1 AND operation_id IS NULL", event).Scan(&count); err != nil || count != 1 {
		t.Fatal("source CAS fault falsely marked delivered")
	}
	process.stop()
	client.Close()
	process = senderReceiverProcess(t, dsn, serverConfig)
	processLogs = append(processLogs, process.logs)
	cfg.BaseURL = process.baseURL
	client, err = rtcrevocation.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	countClient.client = client
	if _, err := source.Exec(ctx, "DROP TRIGGER reject_receipt_cas ON identity_revocation_delivery"); err != nil {
		t.Fatal(err)
	}
	if _, err := source.Exec(ctx, "UPDATE identity_revocation_delivery SET claim_until=clock_timestamp()-interval '1 second' WHERE event_id=$1", event); err != nil {
		t.Fatal(err)
	}
	if err := delivery.NewWorker(repo, countClient, logger).Step(ctx); err != nil {
		t.Fatal("durable restart/takeover failed")
	}
	if countClient.apply != 2 || countClient.lookup != 1 {
		t.Fatal("recovery did not use actual own receipt")
	}
	if err := source.QueryRow(ctx, "SELECT COUNT(*) FROM identity_revocation_delivery WHERE event_id=$1 AND state='delivered' AND attempt=2 AND claim_fence=2 AND operation_id=$2 AND registry_media_effect='no_matching_registry_grants' AND affected_registry_grants=0", event, operation).Scan(&count); err != nil || count != 1 {
		t.Fatal("source receipt mapping/takeover differs")
	}
	if err := receiver.QueryRow(ctx, "SELECT COUNT(*) FROM rtc_media_source_inbox WHERE event_id=$1 AND operation_id=$2", event, operation).Scan(&count); err != nil || count != 1 {
		t.Fatal("restart/replay duplicated operation")
	}
	conflictAuth := senderAccount(t, ctx, source)
	if changed, err := postgres.NewRepository(source).RevokeSession(ctx, conflictAuth.User.ID, conflictAuth.Session.ID, time.Now()); err != nil || !changed {
		t.Fatal("conflict source revoke failed")
	}
	var conflicting delivery.Event
	var session uuid.UUID
	if err := source.QueryRow(ctx, "SELECT id,subject_id,user_id,device_id,session_id,subject_kind,source_revision FROM identity_authority_revocation_outbox WHERE subject_id=$1", conflictAuth.Session.ID).Scan(&conflicting.ID, &conflicting.SubjectID, &conflicting.UserID, &conflicting.DeviceID, &session, &conflicting.Kind, &conflicting.Revision); err != nil {
		t.Fatal(err)
	}
	conflicting.SessionID = session
	wrongCA := authorityCA(t)
	wrongFile := filepath.Join(t.TempDir(), "wrong-server-ca.crt")
	if err := os.WriteFile(wrongFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: wrongCA.certificate.Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	wrongCfg := cfg
	wrongCfg.ServerCAFile = wrongFile
	badClient, err := rtcrevocation.NewClient(wrongCfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(badClient.Close)
	if err := delivery.NewWorker(repo, badClient, logger).Step(ctx); !errors.Is(err, delivery.ErrUnavailable) {
		t.Fatal("first actual TLS network failure not preserved")
	}
	if err := receiver.QueryRow(ctx, "SELECT COUNT(*) FROM rtc_media_source_inbox WHERE event_id=$1", conflicting.ID).Scan(&count); err != nil || count != 0 {
		t.Fatal("wrong server CA submitted event")
	}
	changed := conflicting
	changed.Revision++
	if _, err := client.Apply(ctx, changed); err != nil {
		t.Fatal("owned existing conflicting RTC tuple fixture failed")
	}
	if _, err := source.Exec(ctx, "UPDATE identity_revocation_delivery SET next_attempt_at=clock_timestamp() WHERE event_id=$1", conflicting.ID); err != nil {
		t.Fatal(err)
	}
	recoveredClient := &senderCountClient{client: client}
	if err := delivery.NewWorker(repo, recoveredClient, logger).Step(ctx); err != nil {
		t.Fatal("recovered conflict quarantine failed")
	}
	if recoveredClient.lookup != 1 || recoveredClient.apply != 1 {
		t.Fatal("event-only lookup hid canonical conflict")
	}
	if err := source.QueryRow(ctx, "SELECT COUNT(*) FROM identity_revocation_delivery d JOIN identity_authority_revocation_outbox e ON e.id=d.event_id WHERE d.event_id=$1 AND state='quarantined' AND quarantine_reason='canonical_conflict' AND operation_id IS NULL AND e.source_revision=2", conflicting.ID).Scan(&count); err != nil || count != 1 {
		t.Fatal("conflicting RTC receipt falsely marked source delivered")
	}
	if err := delivery.NewWorker(repo, recoveredClient, logger).Step(ctx); err != nil || recoveredClient.lookup != 1 || recoveredClient.apply != 1 {
		t.Fatal("quarantined event automatically retried")
	}
	for _, marker := range []string{auth.User.ID, auth.Device.ID, auth.Session.ID, event.String(), conflictAuth.User.ID, conflictAuth.Session.ID, conflicting.ID.String(), "PRIVATE KEY"} {
		if strings.Contains(processLogs[0].String()+processLogs[1].String(), marker) {
			t.Fatal("receiver logs exposed payload")
		}
	}
}

func TestIdentitySenderClientOwnedTLSBoundary(t *testing.T) {
	ca := authorityCA(t)
	files := authorityTLSConfig(t, ca)
	good := authorityLeaf(t, ca, x509.ExtKeyUsageClientAuth, []string{"urn:aerochat:service:identity"}, false)
	cert, key := senderCertificateFiles(t, good)
	var requests, targetCalls atomic.Int64
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { targetCalls.Add(1); w.WriteHeader(500) }))
	t.Cleanup(target.Close)
	serverLeaf := authorityLeaf(t, ca, x509.ExtKeyUsageServerAuth, nil, false)
	upstream := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	upstream.TLS = &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{serverLeaf}, ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: ca.roots}
	upstream.StartTLS()
	t.Cleanup(upstream.Close)
	cfg := rtcrevocation.Config{Enabled: true, BaseURL: upstream.URL, ServerCAFile: files.ClientCAFile, TLSCertFile: cert, TLSKeyFile: key}
	client, err := rtcrevocation.NewClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	subject := uuid.New()
	event := delivery.Event{ID: uuid.New(), SubjectID: subject, SessionID: subject, UserID: uuid.New(), DeviceID: uuid.New(), Kind: "session", Revision: 2}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err := client.Apply(ctx, event); !errors.Is(err, delivery.ErrUnavailable) {
		t.Fatal("redirect must be static unavailable")
	}
	if requests.Load() != 1 || targetCalls.Load() != 0 {
		t.Fatal("private client followed redirect outside configured authority")
	}
	for _, scenario := range []struct {
		name    string
		usage   x509.ExtKeyUsage
		uri     []string
		expired bool
	}{
		{"wrong_uri", x509.ExtKeyUsageClientAuth, []string{"urn:aerochat:service:chat"}, false},
		{"ambiguous", x509.ExtKeyUsageClientAuth, []string{"urn:aerochat:service:identity", "urn:aerochat:service:chat"}, false},
		{"wrong_eku", x509.ExtKeyUsageServerAuth, []string{"urn:aerochat:service:identity"}, false},
		{"expired", x509.ExtKeyUsageClientAuth, []string{"urn:aerochat:service:identity"}, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			leaf := authorityLeaf(t, ca, scenario.usage, scenario.uri, scenario.expired)
			bad := cfg
			bad.TLSCertFile, bad.TLSKeyFile = senderCertificateFiles(t, leaf)
			if _, err := rtcrevocation.NewClient(bad); err == nil {
				t.Fatal("invalid producer certificate accepted")
			}
			if requests.Load() != 1 {
				t.Fatal("invalid producer certificate made request")
			}
		})
	}
	// Standard x509 SAN mismatch проверяет hostname, не добавляя insecure override.
	keyLeaf := serverLeaf.PrivateKey.(*ecdsa.PrivateKey)
	template := &x509.Certificate{SerialNumber: big.NewInt(ca.serial + 1), NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, DNSNames: []string{"invalid.owned.fixture"}}
	der, err := x509.CreateCertificate(rand.Reader, template, ca.certificate, &keyLeaf.PublicKey, ca.key)
	if err != nil {
		t.Fatal(err)
	}
	mismatch := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { requests.Add(1); w.WriteHeader(500) }))
	mismatch.TLS = &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: keyLeaf}}}
	mismatch.StartTLS()
	t.Cleanup(mismatch.Close)
	bad := cfg
	bad.BaseURL = mismatch.URL
	mismatchClient, err := rtcrevocation.NewClient(bad)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mismatchClient.Close)
	mismatchContext, mismatchCancel := context.WithTimeout(context.Background(), time.Second)
	defer mismatchCancel()
	if _, err := mismatchClient.Apply(mismatchContext, event); !errors.Is(err, delivery.ErrUnavailable) {
		t.Fatal("server SAN mismatch must reject")
	}
	if requests.Load() != 1 {
		t.Fatal("hostname mismatch reached HTTP handler")
	}
}

func TestIdentitySenderEnabledWrapperCancelsClaimAndRecovers(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	source := privateAuthorityDatabase(t, ctx)
	receiver, dsn := senderRTCFixture(t, ctx)
	ca := authorityCA(t)
	serverConfig := authorityTLSConfig(t, ca)
	leaf := authorityLeaf(t, ca, x509.ExtKeyUsageClientAuth, []string{"urn:aerochat:service:identity"}, false)
	cert, key := senderCertificateFiles(t, leaf)
	process := senderReceiverProcess(t, dsn, serverConfig)
	auth := senderAccount(t, ctx, source)
	if changed, err := postgres.NewRepository(source).RevokeSession(ctx, auth.User.ID, auth.Session.ID, time.Now()); err != nil || !changed {
		t.Fatal("actual source revoke failed")
	}
	var event uuid.UUID
	if err := source.QueryRow(ctx, "SELECT id FROM identity_authority_revocation_outbox WHERE subject_id=$1", auth.Session.ID).Scan(&event); err != nil {
		t.Fatal(err)
	}
	actorConfig := source.Config().Copy()
	actorConfig.MaxConns = 1
	actorConfig.ConnConfig.RuntimeParams["application_name"] += "_sender_wrapper"
	actor, err := pgxpool.NewWithConfig(ctx, actorConfig)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(actor.Close)
	var actorPID int32
	if err := actor.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&actorPID); err != nil {
		t.Fatal(err)
	}
	lock, err := source.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
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
	if _, err := source.Exec(ctx, "CREATE FUNCTION block_wrapper_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock("+strconv.FormatInt(barrier, 10)+"); RETURN NEW; END $$; CREATE TRIGGER block_wrapper_claim BEFORE UPDATE ON identity_revocation_delivery FOR EACH ROW EXECUTE FUNCTION block_wrapper_claim()"); err != nil {
		t.Fatal(err)
	}
	port, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	public := port.Addr().String()
	_ = port.Close()
	clientConfig := rtcrevocation.Config{Enabled: true, BaseURL: process.baseURL, ServerCAFile: serverConfig.ClientCAFile, TLSCertFile: cert, TLSKeyFile: key}
	cfg := Config{HTTPAddress: public, ShutdownTimeout: time.Second, RevocationDelivery: clientConfig}
	logs := &authorityLogBuffer{}
	logger := slog.New(slog.NewTextHandler(logs, nil))
	appContext, stopApp := context.WithCancel(ctx)
	defer stopApp()
	result := make(chan error, 1)
	go func() {
		result <- RunServersWithSourceDelivery(appContext, logger, cfg, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) }), nil, postgres.NewDeliveryRepository(actor))
		close(result)
	}()
	var waited sync.Once
	waitStopped := func() {
		waited.Do(func() {
			stopApp()
			select {
			case err := <-result:
				if err != nil && !errors.Is(err, context.Canceled) {
					t.Error("app/worker shutdown failed")
				}
			case <-time.After(3 * time.Second):
				t.Error("app/worker shutdown exceeded bound")
			}
		})
	}
	t.Cleanup(waitStopped)
	httpTransport := &http.Transport{Proxy: nil}
	httpClient := &http.Client{Transport: httpTransport, Timeout: 200 * time.Millisecond}
	defer httpTransport.CloseIdleConnections()
	deadline := time.Now().Add(3 * time.Second)
	ready, blocked := false, false
	for time.Now().Before(deadline) {
		if !ready {
			response, err := httpClient.Get("http://" + public + "/")
			if err == nil {
				_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
				_ = response.Body.Close()
				ready = response.StatusCode == 200
			}
		}
		if err := source.QueryRow(ctx, "SELECT $1=ANY(pg_blocking_pids($2)) AND position('-- name: ClaimAuthorityDelivery' in query)>0 FROM pg_stat_activity WHERE pid=$2", lockerPID, actorPID).Scan(&blocked); err != nil {
			t.Fatal("cannot observe owned Claim barrier")
		}
		if ready && blocked {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("wrapper observation context expired")
		case <-time.After(10 * time.Millisecond):
		}
	}
	if !ready || !blocked {
		t.Fatal("enabled HTTP/Worker.Run Claim barrier not observed")
	}
	stopApp()
	waitStopped()
	response, err := httpClient.Get("http://" + public + "/")
	if err == nil {
		_ = response.Body.Close()
		t.Fatal("HTTP server survived wrapper cancellation")
	}
	var count int
	if err := source.QueryRow(ctx, "SELECT COUNT(*) FROM identity_revocation_delivery WHERE event_id=$1 AND state='pending' AND attempt=0 AND claim_fence=0 AND claim_owner IS NULL AND operation_id IS NULL", event).Scan(&count); err != nil || count != 1 {
		t.Fatal("canceled blocked claim fabricated journal delivery")
	}
	if err := receiver.QueryRow(ctx, "SELECT COUNT(*) FROM rtc_media_source_inbox WHERE event_id=$1", event).Scan(&count); err != nil || count != 0 {
		t.Fatal("canceled claim reached RTC")
	}
	if err := lock.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := source.Exec(ctx, "DROP TRIGGER block_wrapper_claim ON identity_revocation_delivery"); err != nil {
		t.Fatal(err)
	}
	client, err := rtcrevocation.NewClient(clientConfig)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	if err := delivery.NewWorker(postgres.NewDeliveryRepository(actor), client, logger).Step(ctx); err != nil {
		t.Fatal("fresh worker failed after canceled wrapper")
	}
	if err := source.QueryRow(ctx, "SELECT COUNT(*) FROM identity_revocation_delivery WHERE event_id=$1 AND state='delivered' AND attempt=1 AND claim_fence=1 AND registry_media_effect='no_matching_registry_grants'", event).Scan(&count); err != nil || count != 1 {
		t.Fatal("fresh worker did not deliver retained event")
	}
	for _, marker := range []string{event.String(), auth.User.ID, auth.Session.ID, auth.Device.ID, "PRIVATE KEY"} {
		if strings.Contains(logs.String()+process.logs.String(), marker) {
			t.Fatal("worker/app logs exposed payload")
		}
	}
}
