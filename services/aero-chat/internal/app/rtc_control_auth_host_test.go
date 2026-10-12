package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"runtime/debug"
	"sync"
	"syscall"
	"testing"
	"time"

	chatconnect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1/chatv1connect"
	libauth "github.com/MattoYuzuru/AeroChat/libs/go/auth"
	"github.com/MattoYuzuru/AeroChat/libs/go/dbbootstrap"
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
	chatschema "github.com/MattoYuzuru/AeroChat/services/aero-chat/db/schema"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/storage/postgres"
	connecthandler "github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/transport/connect"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Test-host запускает production Chat domain/listeners; это не main/Compose runtime.
type rtcAuthHostProfile struct {
	DatabaseURL, Schema, ApplicationName       string
	PublicAddress, PrivateAddress              string
	TLSCertFile, TLSKeyFile, ClientCAFile      string
	CountFile, ExpectedHead, ExpectedBinarySHA string
}

func TestMain(m *testing.M) {
	path := os.Getenv("AERO_RTC_CONTROL_CHAT_HOST_PROFILE")
	if path == "" {
		os.Exit(m.Run())
	}
	if err := runRTCAuthChatHost(path); err != nil {
		_, _ = os.Stderr.WriteString("owned Chat authorization test host failed\n")
		os.Exit(1)
	}
	os.Exit(0)
}
func readRTCAuthHostProfile(path string) (rtcAuthHostProfile, error) {
	var p rtcAuthHostProfile
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() > 16384 {
		return p, errors.New("invalid owned host profile")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return p, errors.New("owned profile unavailable")
	}
	if json.Unmarshal(data, &p) != nil || !regexp.MustCompile(`^rtc_test_[0-9a-f]{32}$`).MatchString(p.Schema) || p.ApplicationName == "" || !regexp.MustCompile(`^[0-9a-f]{40}$`).MatchString(p.ExpectedHead) || !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(p.ExpectedBinarySHA) {
		return p, errors.New("owned host binding invalid")
	}
	exe, err := os.Executable()
	if err != nil {
		return p, errors.New("owned binary unavailable")
	}
	raw, err := os.ReadFile(exe)
	if err != nil {
		return p, errors.New("owned binary unreadable")
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != p.ExpectedBinarySHA {
		return p, errors.New("owned binary changed")
	}
	build, ok := debug.ReadBuildInfo()
	if !ok || build.GoVersion != "go1.25.8" {
		return p, errors.New("owned Go toolchain mismatch")
	}
	values := map[string]string{}
	for _, s := range build.Settings {
		values[s.Key] = s.Value
	}
	if values["vcs.revision"] != p.ExpectedHead || values["vcs.modified"] != "false" {
		return p, errors.New("owned source binding mismatch")
	}
	for _, address := range []string{p.PublicAddress, p.PrivateAddress} {
		host, port, err := net.SplitHostPort(address)
		if err != nil || host != "127.0.0.1" || port == "" {
			return p, errors.New("owned host must use loopback")
		}
	}
	return p, nil
}

// Fixture не создаёт typing. Clear отсутствующей записи не подменяет auth facts.
var errRTCAuthTypingUnavailable = errors.New("owned typing method unavailable")

type rtcAuthEmptyTyping struct{}

func (rtcAuthEmptyTyping) PutDirectChatTypingIndicator(context.Context, chat.PutDirectChatTypingIndicatorParams) error {
	return errRTCAuthTypingUnavailable
}
func (rtcAuthEmptyTyping) ClearDirectChatTypingIndicator(context.Context, string, string) error {
	return errRTCAuthTypingUnavailable
}
func (rtcAuthEmptyTyping) ListDirectChatTypingIndicators(context.Context, string, []string, time.Time) (map[string]chat.DirectChatTypingIndicator, error) {
	return nil, errRTCAuthTypingUnavailable
}
func (rtcAuthEmptyTyping) PutGroupTypingIndicator(context.Context, chat.PutGroupTypingIndicatorParams) error {
	return errRTCAuthTypingUnavailable
}
func (rtcAuthEmptyTyping) ClearGroupTypingIndicator(context.Context, string, string, string) error {
	return nil
}
func (rtcAuthEmptyTyping) ListGroupTypingIndicators(context.Context, string, string, []string, time.Time) (map[string]chat.DirectChatTypingIndicator, error) {
	return nil, errRTCAuthTypingUnavailable
}

type rtcAuthChatSource struct {
	inner *chat.GroupSubjectAuthorizer
	mu    sync.Mutex
	calls int64
	path  string
}

func (s *rtcAuthChatSource) CheckGroupSubject(ctx context.Context, group, user string) (*chat.GroupSubjectAuthority, error) {
	s.mu.Lock()
	s.calls++
	data, err := json.Marshal(map[string]int64{"check_group_subject": s.calls})
	if err == nil {
		var f *os.File
		f, err = os.OpenFile(s.path, os.O_WRONLY|os.O_TRUNC, 0600)
		if err == nil {
			_, err = f.Write(data)
			closeErr := f.Close()
			if err == nil {
				err = closeErr
			}
		}
	}
	s.mu.Unlock()
	if err != nil {
		return nil, chat.ErrGroupAuthorityUnavailable
	}
	return s.inner.CheckGroupSubject(ctx, group, user)
}
func rtcAuthGroupPath(path string) bool {
	switch path {
	case chatconnect.ChatServicePingProcedure, chatconnect.ChatServiceCreateGroupProcedure, chatconnect.ChatServiceCreateGroupInviteLinkProcedure, chatconnect.ChatServiceJoinGroupByInviteLinkProcedure, chatconnect.ChatServiceUpdateGroupMemberRoleProcedure, chatconnect.ChatServiceTransferGroupOwnershipProcedure, chatconnect.ChatServiceRemoveGroupMemberProcedure:
		return true
	default:
		return false
	}
}
func runRTCAuthChatHost(path string) error {
	profile, err := readRTCAuthHostProfile(path)
	if err != nil {
		return err
	}
	cfg, err := pgxpool.ParseConfig(profile.DatabaseURL)
	if err != nil || cfg.ConnConfig.Database != "aerochat_rtc_test" || (cfg.ConnConfig.Host != "localhost" && cfg.ConnConfig.Host != "127.0.0.1") || cfg.ConnConfig.RuntimeParams["search_path"] != profile.Schema || cfg.ConnConfig.RuntimeParams["application_name"] != profile.ApplicationName {
		return errors.New("owned DSN binding invalid")
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return errors.New("owned pool unavailable")
	}
	defer db.Close()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := dbbootstrap.Apply(ctx, db, dbbootstrap.Options{ServiceName: "aero-chat", Files: chatschema.Files, Logger: logger, Requirements: []dbbootstrap.Requirement{{ServiceName: "aero-identity", Migration: "000003_crypto_device_registry_foundation.sql"}}}); err != nil {
		return errors.New("owned Chat bootstrap failed")
	}
	repo := postgres.NewRepository(db)
	service := chat.NewService(repo, repo, rtcAuthEmptyTyping{}, nil, nil, nil, libauth.NewSessionTokenManager(), time.Second, time.Second, time.Minute, 1024, 1024, 100, "owned-unused")
	publicHandler := NewHTTPHandler(logger, observability.ServiceMeta{Name: "owned-chat-auth-host", Version: profile.ExpectedHead}, repo.Ping, connecthandler.NewHandler("owned-chat-auth-host", profile.ExpectedHead, service))
	public := &http.Server{Addr: profile.PublicAddress, ReadHeaderTimeout: time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, MaxHeaderBytes: 8192, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && (r.URL.Path == "/healthz" || r.URL.Path == "/readyz") {
			publicHandler.ServeHTTP(w, r)
			return
		}
		if !rtcAuthGroupPath(r.URL.Path) {
			http.NotFound(w, r)
			return
		}
		publicHandler.ServeHTTP(w, r)
	})}
	info, err := os.Lstat(profile.CountFile)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
		return errors.New("owned counter file invalid")
	}
	private, err := NewInternalAuthorizationServer(InternalAuthorizationConfig{Enabled: true, Address: profile.PrivateAddress, TLSCertFile: profile.TLSCertFile, TLSKeyFile: profile.TLSKeyFile, ClientCAFile: profile.ClientCAFile}, logger, &rtcAuthChatSource{inner: chat.NewGroupSubjectAuthorizer(repo), path: profile.CountFile})
	if err != nil || private == nil {
		return errors.New("owned private listener invalid")
	}
	pubListener, err := net.Listen("tcp", public.Addr)
	if err != nil {
		return errors.New("owned public bind failed")
	}
	defer func() { _ = pubListener.Close() }()
	privateListener, err := net.Listen("tcp", private.Addr)
	if err != nil {
		return errors.New("owned private bind failed")
	}
	defer func() { _ = privateListener.Close() }()
	results := make(chan error, 2)
	go func() { results <- public.Serve(pubListener) }()
	go func() { results <- private.ServeTLS(privateListener, "", "") }()
	var first error
	remaining := 2
	select {
	case first = <-results:
		remaining--
	case <-ctx.Done():
	}
	cleanup, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if public.Shutdown(cleanup) != nil {
		_ = public.Close()
	}
	if private.Shutdown(cleanup) != nil {
		_ = private.Close()
	}
	for remaining > 0 {
		select {
		case serveErr := <-results:
			remaining--
			if serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) && first == nil {
				first = serveErr
			}
		case <-time.After(time.Second):
			return errors.New("owned host listener did not stop")
		}
	}
	if first != nil && !errors.Is(first, http.ErrServerClosed) {
		return errors.New("owned host stopped unexpectedly")
	}
	return nil
}
