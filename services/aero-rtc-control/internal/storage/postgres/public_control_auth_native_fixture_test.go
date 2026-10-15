//go:build integration

package postgres

import (
	"context"
	"crypto/sha256"
	"debug/buildinfo"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"connectrpc.com/connect"
	cpb "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1"
	cc "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1/chatv1connect"
	ipb "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1"
	ic "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1/identityv1connect"
	rpb "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1"
	rc "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1/rtcv1connect"
	"github.com/MattoYuzuru/AeroChat/libs/go/dbbootstrap"
	chatschema "github.com/MattoYuzuru/AeroChat/services/aero-chat/db/schema"
	identityschema "github.com/MattoYuzuru/AeroChat/services/aero-identity/db/schema"
	rtcschema "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/db/schema"
	control "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediacontrol"
	media "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediastore"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/rtc"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/downstream"
	transport "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/transport/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
)

type publicControlNativeUser struct {
	token, login, password string
	subject                control.OwnStatusSubject
}
type countedActualControlAuthority struct {
	inner                 *downstream.PrivateAuthorityClient
	resolve, bound, group atomic.Int64
}

func (a *countedActualControlAuthority) Resolve(ctx context.Context, s string) (control.OwnStatusSubject, error) {
	a.resolve.Add(1)
	return a.inner.Resolve(ctx, s)
}
func (a *countedActualControlAuthority) CheckBound(ctx context.Context, s control.OwnStatusSubject) (control.OwnStatusSubject, error) {
	a.bound.Add(1)
	return a.inner.CheckBound(ctx, s)
}
func (a *countedActualControlAuthority) CheckGroup(ctx context.Context, g, u uuid.UUID) (control.GroupFacts, error) {
	a.group.Add(1)
	return a.inner.CheckGroup(ctx, g, u)
}

type publicControlNativeFixture struct {
	db                              *pgxpool.Pool
	store                           *MediaStore
	coordinator                     *MediaControlStore
	identity                        ic.IdentityServiceClient
	chat                            cc.ChatServiceClient
	authority                       *countedActualControlAuthority
	client                          rc.GroupMediaControlServiceClient
	publicURL, identityURL, chatURL string
	config                          downstream.PrivateAuthorityConfig
	ca                              receiverCA
	chatCountFile                   string
	a, b                            publicControlNativeUser
	group                           uuid.UUID
	stopSources                     func()
	stopChat                        func()
}

func controlNativePort(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal("owned port reservation")
	}
	address := l.Addr().String()
	if l.Close() != nil {
		t.Fatal("owned reservation close")
	}
	return address
}
func controlNativeBinary(t *testing.T, key, packagePath string) string {
	t.Helper()
	path := os.Getenv(key)
	expected := os.Getenv(key + "_SHA256")
	head := os.Getenv("AERO_RTC_CONTROL_AUTH_TEST_HEAD")
	if path == "" || expected == "" || len(head) != 40 {
		t.Fatal("required exact-source native binary profile absent")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal("owned native binary unreadable")
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != expected {
		t.Fatal("owned native binary changed")
	}
	info, err := buildinfo.ReadFile(path)
	if err != nil || info.GoVersion != "go1.27.2" || info.Path != packagePath {
		t.Fatal("owned native package/toolchain mismatch")
	}
	settings := map[string]string{}
	for _, s := range info.Settings {
		settings[s.Key] = s.Value
	}
	if settings["vcs.revision"] != head || settings["vcs.modified"] != "false" {
		t.Fatal("owned native VCS mismatch")
	}
	return path
}
func startControlNativeChild(t *testing.T, binary string, env []string) func() {
	t.Helper()
	log, err := os.OpenFile(filepath.Join(t.TempDir(), "owned-child.log"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal("owned native log")
	}
	cmd := exec.Command(binary)
	cmd.Env = append([]string{"PATH=" + os.Getenv("PATH")}, env...)
	// Наследуем runner group: внешняя TERM/KILL очистка охватывает все три native PID.
	cmd.Stdout = log
	cmd.Stderr = log
	if cmd.Start() != nil {
		_ = log.Close()
		t.Fatal("owned native child start")
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	var once sync.Once
	stop := func() {
		once.Do(func() {
			select {
			case <-done:
				t.Error("owned native child exited before requested stop")
			default:
				_ = cmd.Process.Signal(syscall.SIGTERM)
				select {
				case <-done:
				case <-time.After(3 * time.Second):
					_ = cmd.Process.Kill()
					select {
					case <-done:
					case <-time.After(3 * time.Second):
						t.Error("owned native child did not stop")
					}
				}
			}
			_ = log.Close()
			if err := controlNativeEvent(map[string]any{"kind": "child_stopped", "pid": cmd.Process.Pid}); err != nil {
				t.Error("owned child stop evidence unavailable")
			}
		})
	}
	t.Cleanup(stop)
	group, err := syscall.Getpgid(cmd.Process.Pid)
	if err != nil || group != syscall.Getpgrp() {
		t.Fatal("owned native child escaped runner process group")
	}
	if err := controlNativeEvent(map[string]any{"kind": "child_started", "pid": cmd.Process.Pid, "pgid": group, "executable": binary}); err != nil {
		t.Fatal("owned child start evidence unavailable")
	}
	t.Logf("rtc_auth_owned_child_pid=%d", cmd.Process.Pid)
	return stop
}
func controlNativeDSN(t *testing.T, db *pgxpool.Pool) string {
	t.Helper()
	cfg := db.Config()
	raw := cfg.ConnConfig.ConnString()
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "postgres" {
		t.Fatal("owned source DSN must be URL")
	}
	q := u.Query()
	for key, value := range cfg.ConnConfig.RuntimeParams {
		q.Set(key, value)
	}
	u.RawQuery = q.Encode()
	out := u.String()
	again, err := pgxpool.ParseConfig(out)
	if err != nil || again.ConnConfig.RuntimeParams["search_path"] != cfg.ConnConfig.RuntimeParams["search_path"] || again.ConnConfig.RuntimeParams["application_name"] != cfg.ConnConfig.RuntimeParams["application_name"] {
		t.Fatal("owned DSN serialization lost schema")
	}
	return out
}
func controlNativeReady(t *testing.T, url string, version string) {
	t.Helper()
	client := ic.NewIdentityServiceClient(controlNativeHTTPClient(t, time.Second), url)
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		response, err := client.Ping(ctx, connect.NewRequest(&ipb.PingRequest{}))
		cancel()
		if err == nil && response.Msg.Service != nil && response.Msg.Service.Version == version {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("owned native typed readiness failed")
}
func controlNativeChatReady(t *testing.T, url string, version string) {
	t.Helper()
	client := cc.NewChatServiceClient(controlNativeHTTPClient(t, time.Second), url)
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		response, err := client.Ping(ctx, connect.NewRequest(&cpb.PingRequest{}))
		cancel()
		if err == nil && response.Msg.Service != nil && response.Msg.Service.Version == version {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("owned Chat test-host typed readiness failed")
}
func publicControlNative(t *testing.T) *publicControlNativeFixture {
	t.Helper()
	controlNativeDatabaseProfile(t)
	identityBin := controlNativeBinary(t, "AERO_RTC_CONTROL_IDENTITY_TEST_BINARY", "github.com/MattoYuzuru/AeroChat/services/aero-identity/cmd/aero-identity")
	chatBin := controlNativeBinary(t, "AERO_RTC_CONTROL_CHAT_TEST_BINARY", "github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/app.test")
	if err := controlNativeEvent(map[string]any{"kind": "fixture_begin", "test": t.Name(), "pid": os.Getpid(), "pgid": syscall.Getpgrp()}); err != nil {
		t.Fatal("required private native evidence registry absent")
	}
	var ownedSchema string
	var cleanupConfig *pgxpool.Config
	t.Cleanup(func() {
		if ownedSchema == "" || cleanupConfig == nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		admin, err := pgxpool.NewWithConfig(ctx, cleanupConfig)
		if err != nil {
			t.Error("owned schema cleanup verifier unavailable")
			return
		}
		defer admin.Close()
		var exists bool
		if err := admin.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=$1)", ownedSchema).Scan(&exists); err != nil || exists {
			t.Error("owned schema remained after fixture cleanup")
			return
		}
		if err := controlNativeEvent(map[string]any{"kind": "schema_absent", "schema": ownedSchema}); err != nil {
			t.Error("owned schema absence evidence unavailable")
		}
	})
	db := newRTCFixturePool(t)
	ownedSchema = db.Config().ConnConfig.RuntimeParams["search_path"]
	cleanupConfig = db.Config().Copy()
	cleanupConfig.ConnConfig.RuntimeParams["search_path"] = "pg_catalog"
	cleanupConfig.ConnConfig.RuntimeParams["application_name"] = ownedSchema + "_cleanup"
	if err := controlNativeEvent(map[string]any{"kind": "schema_created", "schema": db.Config().ConnConfig.RuntimeParams["search_path"], "application_name": db.Config().ConnConfig.RuntimeParams["application_name"]}); err != nil {
		t.Fatal("owned schema creation evidence unavailable")
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	for _, item := range []dbbootstrap.Options{{ServiceName: "aero-identity", Files: identityschema.Files, Logger: logger}, {ServiceName: "aero-chat", Files: chatschema.Files, Logger: logger}, {ServiceName: "aero-rtc-control", Files: rtcschema.Files, Logger: logger}} {
		if dbbootstrap.Apply(ctx, db, item) != nil {
			t.Fatal("owned registered domain bootstrap failed")
		}
	}
	dsn := controlNativeDSN(t, db)
	dir := t.TempDir()
	ca := newReceiverCA(t)
	_, serverCert, serverKey := receiverLeaf(t, ca, nil, true, false, false)
	_, clientCert, clientKey := receiverLeaf(t, ca, []string{"urn:aerochat:service:rtc-control"}, false, false, false)
	paths := map[string][]byte{"ca.pem": ca.pem, "server.pem": serverCert, "server-key.pem": serverKey, "rtc.pem": clientCert, "rtc-key.pem": clientKey}
	for name, data := range paths {
		if os.WriteFile(filepath.Join(dir, name), data, 0600) != nil {
			t.Fatal("owned native TLS file")
		}
	}
	idPublic, idPrivate, chatPublic, chatPrivate := controlNativePort(t), controlNativePort(t), controlNativePort(t), controlNativePort(t)
	head := os.Getenv("AERO_RTC_CONTROL_AUTH_TEST_HEAD")
	stopId := startControlNativeChild(t, identityBin, []string{"AERO_DATABASE_URL=" + dsn, "AERO_HTTP_ADDR=" + idPublic, "AERO_LOG_LEVEL=error", "AERO_AUTH_PASSWORD_CONCURRENCY=1", "AERO_IDENTITY_INTERNAL_AUTHORIZATION_ENABLED=true", "AERO_IDENTITY_INTERNAL_AUTHORIZATION_LISTEN_ADDR=" + idPrivate, "AERO_IDENTITY_INTERNAL_AUTHORIZATION_TLS_CERT_FILE=" + filepath.Join(dir, "server.pem"), "AERO_IDENTITY_INTERNAL_AUTHORIZATION_TLS_KEY_FILE=" + filepath.Join(dir, "server-key.pem"), "AERO_IDENTITY_INTERNAL_AUTHORIZATION_CLIENT_CA_FILE=" + filepath.Join(dir, "ca.pem")})
	controlNativeReady(t, "http://"+idPublic, head)
	count := filepath.Join(dir, "chat-count.json")
	if os.WriteFile(count, []byte(`{"check_group_subject":0}`), 0600) != nil {
		t.Fatal("owned count file")
	}
	profile := map[string]string{"DatabaseURL": dsn, "Schema": db.Config().ConnConfig.RuntimeParams["search_path"], "ApplicationName": db.Config().ConnConfig.RuntimeParams["application_name"], "PublicAddress": chatPublic, "PrivateAddress": chatPrivate, "TLSCertFile": filepath.Join(dir, "server.pem"), "TLSKeyFile": filepath.Join(dir, "server-key.pem"), "ClientCAFile": filepath.Join(dir, "ca.pem"), "CountFile": count, "ExpectedHead": head, "ExpectedBinarySHA": os.Getenv("AERO_RTC_CONTROL_CHAT_TEST_BINARY_SHA256")}
	data, err := json.Marshal(profile)
	if err != nil {
		t.Fatal("owned profile encode")
	}
	profilePath := filepath.Join(dir, "chat-profile.json")
	if os.WriteFile(profilePath, data, 0600) != nil {
		t.Fatal("owned private profile")
	}
	stopChat := startControlNativeChild(t, chatBin, []string{"AERO_RTC_CONTROL_CHAT_HOST_PROFILE=" + profilePath})
	controlNativeChatReady(t, "http://"+chatPublic, head)
	f := &publicControlNativeFixture{db: db, identityURL: "http://" + idPublic, chatURL: "http://" + chatPublic, chatCountFile: count, ca: ca, config: downstream.PrivateAuthorityConfig{IdentityBaseURL: "https://" + idPrivate, ChatBaseURL: "https://" + chatPrivate, ServerCAFile: filepath.Join(dir, "ca.pem"), TLSCertFile: filepath.Join(dir, "rtc.pem"), TLSKeyFile: filepath.Join(dir, "rtc-key.pem")}, stopSources: func() { stopChat(); stopId() }, stopChat: stopChat}
	f.identity = ic.NewIdentityServiceClient(controlNativeHTTPClient(t, 5*time.Second), f.identityURL)
	f.chat = cc.NewChatServiceClient(controlNativeHTTPClient(t, 5*time.Second), f.chatURL)
	client, err := downstream.NewPrivateAuthorityClient(f.config)
	if err != nil {
		t.Fatal("owned typed authority constructor")
	}
	t.Cleanup(client.Close)
	f.authority = &countedActualControlAuthority{inner: client}
	f.store = NewMediaStoreWithMediaSlotGuard(db)
	f.coordinator = NewMediaControlStore(f.store)
	f.a = f.register(t, "a")
	f.b = f.register(t, "b")
	group, err := f.chat.CreateGroup(context.Background(), controlNativeRequest(&cpb.CreateGroupRequest{Name: "Owned auth group"}, f.a.token))
	if err != nil {
		t.Fatal("actual group create failed")
	}
	f.group = uuid.MustParse(group.Msg.Group.Id)
	invite, err := f.chat.CreateGroupInviteLink(context.Background(), controlNativeRequest(&cpb.CreateGroupInviteLinkRequest{GroupId: f.group.String(), Role: cpb.GroupMemberRole_GROUP_MEMBER_ROLE_MEMBER}, f.a.token))
	if err != nil {
		t.Fatal("actual invite writer failed")
	}
	if _, err := f.chat.JoinGroupByInviteLink(context.Background(), controlNativeRequest(&cpb.JoinGroupByInviteLinkRequest{InviteToken: invite.Msg.InviteToken}, f.b.token)); err != nil {
		t.Fatal("actual membership join failed")
	}
	service, err := control.NewAuthorizedService(f.coordinator, f.authority)
	if err != nil {
		t.Fatal(err)
	}
	handler, err := transport.NewAuthorizedGroupMediaControlHTTPHandler(service)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal("owned control listener")
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, MaxHeaderBytes: 8192, IdleTimeout: 10 * time.Second}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if server.Shutdown(ctx) != nil {
			_ = server.Close()
		}
	})
	f.publicURL = "http://" + listener.Addr().String()
	f.client = rc.NewGroupMediaControlServiceClient(controlNativeHTTPClient(t, 6*time.Second), f.publicURL)
	return f
}
func controlNativeRequest[T any](msg *T, token string) *connect.Request[T] {
	r := connect.NewRequest(msg)
	r.Header().Set("Authorization", "Bearer "+token)
	return r
}
func (f *publicControlNativeFixture) register(t *testing.T, suffix string) publicControlNativeUser {
	t.Helper()
	u := publicControlNativeUser{login: "auth" + suffix + "." + uuid.NewString()[:8], password: "Owned-private-" + uuid.NewString()}
	response, err := f.identity.Register(context.Background(), connect.NewRequest(&ipb.RegisterRequest{Login: u.login, Password: u.password, Nickname: "Owned native subject"}))
	if err != nil || response.Msg.Auth == nil {
		t.Fatal("real opaque register failed")
	}
	u.token = response.Msg.Auth.SessionToken
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	u.subject, err = f.authority.Resolve(ctx, u.token)
	if err != nil {
		t.Fatal("actual private Resolve failed")
	}
	return u
}
func (f *publicControlNativeFixture) login(t *testing.T, u publicControlNativeUser) publicControlNativeUser {
	t.Helper()
	response, err := f.identity.Login(context.Background(), connect.NewRequest(&ipb.LoginRequest{Login: u.login, Password: u.password}))
	if err != nil {
		t.Fatal("actual new-session Login failed")
	}
	u.token = response.Msg.Auth.SessionToken
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	u.subject, err = f.authority.Resolve(ctx, u.token)
	if err != nil {
		t.Fatal("actual new-session Resolve failed")
	}
	return u
}
func (f *publicControlNativeFixture) held(t *testing.T, u publicControlNativeUser) (uuid.UUID, media.Grant) {
	t.Helper()
	now := time.Now().UTC()
	call := uuid.New()
	c := rtc.Call{ID: call.String(), Scope: rtc.ConversationScope{Type: rtc.ScopeTypeGroup, GroupID: f.group.String()}, CreatedByUserID: u.subject.UserID.String(), Status: rtc.CallStatusActive, CreatedAt: now, StartedAt: now, UpdatedAt: now}
	participant := rtc.CallParticipant{ID: uuid.NewString(), CallID: call.String(), UserID: u.subject.UserID.String(), State: rtc.ParticipantStateActive, JoinedAt: now, UpdatedAt: now}
	if _, _, err := NewRepositoryWithMediaSlotGuard(f.db).CreateCallWithParticipant(context.Background(), c, participant); err != nil {
		t.Fatal("owned real-user call fixture failed")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	facts, err := f.authority.CheckGroup(ctx, f.group, u.subject.UserID)
	if err != nil {
		t.Fatal("actual Chat facts failed")
	}
	r := mediaTestRequest(call, f.group, u.subject.UserID)
	r.SessionID = u.subject.SessionID
	r.DeviceID = u.subject.DeviceID
	r.SessionRevision = u.subject.SessionRevision
	r.DeviceRevision = u.subject.DeviceRevision
	r.EligibilityEpoch = facts.Epoch
	g := mustMediaReserve(t, f.store, r)
	return call, g
}
func (f *publicControlNativeFixture) chatCalls(t *testing.T) int64 {
	t.Helper()
	data, err := os.ReadFile(f.chatCountFile)
	if err != nil {
		t.Fatal("owned counter read")
	}
	var value map[string]int64
	if json.Unmarshal(data, &value) != nil {
		t.Fatal("owned counter parse")
	}
	return value["check_group_subject"]
}
func (f *publicControlNativeFixture) rows(t *testing.T) string {
	t.Helper()
	snapshot := map[string]string{}
	for _, table := range []string{"rtc_calls", "rtc_call_participants", "rtc_media_grants", "rtc_media_operation_targets", "rtc_media_operations", "rtc_media_connection_leases", "rtc_media_cleanup_outbox", "rtc_media_control_intents", "rtc_media_control_children", "rtc_media_control_participants", "rtc_media_control_rooms", "rtc_media_deny_watermarks"} {
		var value string
		if f.db.QueryRow(context.Background(), "SELECT COALESCE(jsonb_agg(x ORDER BY x::text),'[]'::jsonb)::text FROM (SELECT to_jsonb(t) x FROM "+table+" t) q").Scan(&value) != nil {
			t.Fatal("owned immutable snapshot failed")
		}
		snapshot[table] = value
	}
	data, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal("owned snapshot encode")
	}
	return string(data)
}
func requireControlPending(t *testing.T, op *rpb.GroupMediaOperation) {
	t.Helper()
	if op == nil || op.OperationId == "" || op.MediaOutcome != rpb.MediaControlOutcome_MEDIA_CONTROL_OUTCOME_PENDING || op.PendingReason != "provider_unverified" {
		t.Fatal("native model journal became provider COMPLETE")
	}
}

// Только owned lifecycle facts. DSN, tokens и данные пользователей сюда не попадают.
func controlNativeEvent(event map[string]any) error {
	path := os.Getenv("AERO_RTC_CONTROL_AUTH_NATIVE_REGISTRY")
	if !filepath.IsAbs(path) {
		return fmt.Errorf("owned native registry absent")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
		return fmt.Errorf("owned native registry invalid")
	}
	event["recorded_unix_nano"] = time.Now().UnixNano()
	data, err := json.Marshal(event)
	if err != nil || len(data) > 2048 {
		return fmt.Errorf("owned native evidence invalid")
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return fmt.Errorf("owned native registry unavailable")
	}
	_, writeErr := file.Write(append(data, '\n'))
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		return fmt.Errorf("owned native registry write failed")
	}
	return nil
}

func (f *publicControlNativeFixture) emptyCall(t *testing.T, u publicControlNativeUser) uuid.UUID {
	t.Helper()
	now := time.Now().UTC()
	call := uuid.New()
	c := rtc.Call{ID: call.String(), Scope: rtc.ConversationScope{Type: rtc.ScopeTypeGroup, GroupID: f.group.String()}, CreatedByUserID: u.subject.UserID.String(), Status: rtc.CallStatusActive, CreatedAt: now, StartedAt: now, UpdatedAt: now}
	p := rtc.CallParticipant{ID: uuid.NewString(), CallID: call.String(), UserID: u.subject.UserID.String(), State: rtc.ParticipantStateActive, JoinedAt: now, UpdatedAt: now}
	if _, _, err := NewRepositoryWithMediaSlotGuard(f.db).CreateCallWithParticipant(context.Background(), c, p); err != nil {
		t.Fatal("owned empty call fixture")
	}
	return call
}

func controlNativeDatabaseProfile(t *testing.T) {
	t.Helper()
	value := os.Getenv("AERO_RTC_TEST_DATABASE_URL")
	if path := os.Getenv("AERO_RTC_TEST_DATABASE_ENV_FILE"); path != "" {
		info, err := os.Lstat(path)
		if !filepath.IsAbs(path) || err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() > 16384 {
			t.Fatal("required private RTC database profile invalid")
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal("required RTC profile unreadable")
		}
		value = ""
		for _, line := range strings.Split(string(raw), "\n") {
			if candidate, ok := strings.CutPrefix(line, "AERO_DATABASE_URL="); ok {
				value = strings.TrimSpace(candidate)
			}
		}
	}
	if value == "" {
		t.Fatal("required RTC database profile contains no URL")
	}
}

func controlNativeHTTPClient(t *testing.T, timeout time.Duration) *http.Client {
	t.Helper()
	transport := &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: time.Second}).DialContext, IdleConnTimeout: 5 * time.Second, MaxIdleConnsPerHost: 2, MaxConnsPerHost: 2, MaxResponseHeaderBytes: 8192}
	t.Cleanup(transport.CloseIdleConnections)
	return &http.Client{Transport: transport, Timeout: timeout}
}
