//go:build integration

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
	chatauthorizationv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/authorization/v1"
	"github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/authorization/v1/chatauthorizationv1connect"
	"github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1/chatv1connect"
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/app"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/transport/authorization"
	"github.com/google/uuid"
)

type privateGroupCA struct {
	cert *x509.Certificate
	key  *ecdsa.PrivateKey
	der  []byte
}

func privateGroupIssuer(t *testing.T) privateGroupCA {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Owned private fixture"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return privateGroupCA{cert: cert, key: key, der: der}
}

func privateGroupCertificate(t *testing.T, issuer privateGroupCA, uris []string, server, expired bool) (tls.Certificate, []byte, []byte) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 120))
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: serial, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}
	if expired {
		template.NotAfter = time.Now().Add(-time.Minute)
	}
	if server {
		template.DNSNames = []string{"localhost"}
		template.IPAddresses = []net.IP{net.ParseIP("127.0.0.1")}
		template.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}
	}
	for _, uri := range uris {
		parsed, err := url.Parse(uri)
		if err != nil {
			t.Fatal(err)
		}
		template.URIs = append(template.URIs, parsed)
	}
	der, err := x509.CreateCertificate(rand.Reader, template, issuer.cert, &key.PublicKey, issuer.key)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	certPEM, keyPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})
	pair, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		t.Fatal(err)
	}
	return pair, certPEM, keyPEM
}

type privateGroupLogs struct {
	sync.Mutex
	data bytes.Buffer
}

func (l *privateGroupLogs) Write(p []byte) (int, error) {
	l.Lock()
	defer l.Unlock()
	return l.data.Write(p)
}
func (l *privateGroupLogs) text() string { l.Lock(); defer l.Unlock(); return l.data.String() }

type countedGroupService struct {
	inner *chat.GroupSubjectAuthorizer
	calls atomic.Int64
}

func (s *countedGroupService) CheckGroupSubject(ctx context.Context, group, user string) (*chat.GroupSubjectAuthority, error) {
	s.calls.Add(1)
	return s.inner.CheckGroupSubject(ctx, group, user)
}

type countedGroupListener struct {
	net.Listener
	accepted atomic.Int64
}

func (l *countedGroupListener) Accept() (net.Conn, error) {
	conn, err := l.Listener.Accept()
	if err == nil {
		l.accepted.Add(1)
	}
	return conn, err
}

func privateGroupClient(t *testing.T, issuer privateGroupCA, certificate *tls.Certificate) *http.Client {
	t.Helper()
	roots := x509.NewCertPool()
	roots.AddCert(issuer.cert)
	cfg := &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: roots, ServerName: "localhost"}
	if certificate != nil {
		cfg.Certificates = []tls.Certificate{*certificate}
	}
	transport := &http.Transport{TLSClientConfig: cfg}
	t.Cleanup(transport.CloseIdleConnections)
	return &http.Client{Transport: transport, Timeout: 3 * time.Second}
}

func TestPrivateGroupAuthorityActualTLSAndFreshPostgres(t *testing.T) {
	db, ctx := groupAuthorityDatabase(t, false)
	group, user := groupAuthorityPair(t, ctx, db, chat.GroupMemberRoleMember)
	service := &countedGroupService{inner: chat.NewGroupSubjectAuthorizer(NewRepository(db))}
	issuer := privateGroupIssuer(t)
	_, serverPEM, keyPEM := privateGroupCertificate(t, issuer, nil, true, false)
	valid, _, _ := privateGroupCertificate(t, issuer, []string{authorization.CallerURI}, false, false)
	directory := t.TempDir()
	paths := []string{filepath.Join(directory, "server.pem"), filepath.Join(directory, "server-key.pem"), filepath.Join(directory, "client-ca.pem")}
	for i, data := range [][]byte{serverPEM, keyPEM, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: issuer.der})} {
		if err := os.WriteFile(paths[i], data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	logs := &privateGroupLogs{}
	logger := slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	cfg := app.InternalAuthorizationConfig{Enabled: true, Address: "127.0.0.1:0", TLSCertFile: paths[0], TLSKeyFile: paths[1], ClientCAFile: paths[2]}
	for name, data := range map[string][]byte{"empty": {}, "garbage": []byte("invalid CA fixture"), "leaf": serverPEM, "key": keyPEM} {
		t.Run("startup_CA_"+name, func(t *testing.T) {
			badPath := filepath.Join(t.TempDir(), "bad-ca.pem")
			if err := os.WriteFile(badPath, data, 0600); err != nil {
				t.Fatal(err)
			}
			bad := cfg
			bad.ClientCAFile = badPath
			if server, err := app.NewInternalAuthorizationServer(bad, logger, service); err == nil || server != nil {
				t.Fatal("invalid CA material enabled private listener")
			}
		})
	}
	server, err := app.NewInternalAuthorizationServer(cfg, logger, service)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", cfg.Address)
	if err != nil {
		t.Fatal(err)
	}
	counted := &countedGroupListener{Listener: listener}
	finished := make(chan error, 1)
	go func() { finished <- server.ServeTLS(counted, "", "") }()
	t.Cleanup(func() {
		_ = server.Close()
		if err := <-finished; err != nil && !errors.Is(err, http.ErrServerClosed) {
			t.Error("private server fixture failed")
		}
	})
	endpoint := "https://" + listener.Addr().String()
	client := chatauthorizationv1connect.NewInternalAuthorizationServiceClient(privateGroupClient(t, issuer, &valid), endpoint)
	check := func(status chatauthorizationv1.GroupAuthorityStatus, role chatauthorizationv1.GroupAuthorityRole, epoch int64) {
		t.Helper()
		response, err := client.CheckGroupSubject(ctx, connect.NewRequest(&chatauthorizationv1.CheckGroupSubjectRequest{GroupId: group, UserId: user}))
		if err != nil {
			t.Fatal(err)
		}
		got := response.Msg.Authority
		if got == nil || got.GroupId != group || got.UserId != user || got.Status != status || got.Role != role || got.EligibilityEpoch != epoch {
			t.Fatalf("authority=%+v", got)
		}
	}
	present := chatauthorizationv1.GroupAuthorityStatus_GROUP_AUTHORITY_STATUS_PRESENT
	member := chatauthorizationv1.GroupAuthorityRole_GROUP_AUTHORITY_ROLE_MEMBER
	check(present, member, 1)
	groupAuthorityExec(t, ctx, db, "UPDATE group_memberships SET role='admin' WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user))
	check(present, chatauthorizationv1.GroupAuthorityRole_GROUP_AUTHORITY_ROLE_ADMIN, 1)
	groupAuthorityExec(t, ctx, db, "UPDATE group_memberships SET role='owner' WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user))
	check(present, chatauthorizationv1.GroupAuthorityRole_GROUP_AUTHORITY_ROLE_OWNER, 1)
	groupAuthorityExec(t, ctx, db, "UPDATE group_memberships SET role='reader' WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user))
	check(present, chatauthorizationv1.GroupAuthorityRole_GROUP_AUTHORITY_ROLE_READER, 2)
	groupAuthorityExec(t, ctx, db, "UPDATE group_memberships SET role='member' WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user))
	check(present, member, 3)
	groupAuthorityExec(t, ctx, db, "DELETE FROM group_memberships WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user))
	check(chatauthorizationv1.GroupAuthorityStatus_GROUP_AUTHORITY_STATUS_REMOVED, chatauthorizationv1.GroupAuthorityRole_GROUP_AUTHORITY_ROLE_UNSPECIFIED, 4)
	groupAuthorityExec(t, ctx, db, "INSERT INTO group_memberships (group_id,user_id,role,joined_at) VALUES ($1,$2,'member',CURRENT_TIMESTAMP)", mustParseUUID(group), mustParseUUID(user))
	check(present, member, 5)
	if counted.accepted.Load() != 1 {
		t.Fatalf("fresh lookup reconnected instead of reusing TLS: %d", counted.accepted.Load())
	}
	malformed := connect.NewRequest(&chatauthorizationv1.CheckGroupSubjectRequest{GroupId: "private-invalid-ID-marker", UserId: user})
	if response, err := client.CheckGroupSubject(ctx, malformed); response != nil || connect.CodeOf(err) != connect.CodeInvalidArgument || strings.Contains(err.Error(), "private-invalid-ID-marker") {
		t.Fatal("malformed ID did not fail with static error")
	}
	unknown, err := client.CheckGroupSubject(ctx, connect.NewRequest(&chatauthorizationv1.CheckGroupSubjectRequest{GroupId: uuid.NewString(), UserId: user}))
	if err != nil || unknown.Msg.Authority.Status != chatauthorizationv1.GroupAuthorityStatus_GROUP_AUTHORITY_STATUS_NOT_FOUND || unknown.Msg.Authority.GroupId != "" || unknown.Msg.Authority.UserId != "" || unknown.Msg.Authority.EligibilityEpoch != 0 {
		t.Fatal("unknown pair fabricated authority")
	}
	groupAuthorityExec(t, ctx, db, "DELETE FROM group_membership_authority_versions WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user))
	if response, err := client.CheckGroupSubject(ctx, connect.NewRequest(&chatauthorizationv1.CheckGroupSubjectRequest{GroupId: group, UserId: user})); response != nil || connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatal("missing authority was treated as valid or permanent removal")
	}
	groupAuthorityExec(t, ctx, db, "INSERT INTO group_membership_authority_versions (group_id,user_id,revision,present,eligible) VALUES ($1,$2,5,TRUE,TRUE)", mustParseUUID(group), mustParseUUID(user))
	tx := groupAuthorityTx(t, ctx, db)
	if _, err := tx.Exec(ctx, "LOCK TABLE group_membership_authority_versions IN ACCESS EXCLUSIVE MODE"); err != nil {
		t.Fatal(err)
	}
	short, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	result := make(chan error, 1)
	started := time.Now()
	go func() {
		response, err := client.CheckGroupSubject(short, connect.NewRequest(&chatauthorizationv1.CheckGroupSubjectRequest{GroupId: group, UserId: user}))
		if response != nil {
			err = errors.New("cancelled lookup returned authority")
		}
		result <- err
	}()
	waitGroupAuthorityLock(t, ctx, db, tx, result)
	select {
	case err := <-result:
		if err == nil || connect.CodeOf(err) != connect.CodeDeadlineExceeded {
			t.Fatal("client deadline did not cancel actual PostgreSQL lookup")
		}
	case <-ctx.Done():
		t.Fatal("private lookup ignored cancellation")
	}
	if time.Since(started) > 2*time.Second {
		t.Fatal("caller deadline exceeded bounded budget")
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	check(present, member, 5)
	before := service.calls.Load()
	for name, choice := range map[string]struct {
		issuer                  privateGroupCA
		uris                    []string
		server, expired, absent bool
	}{
		"no_certificate": {absent: true},
		"wrong_CA":       {issuer: privateGroupIssuer(t), uris: []string{authorization.CallerURI}},
		"wrong_URI":      {issuer: issuer, uris: []string{"urn:aerochat:service:gateway"}},
		"ambiguous_URI":  {issuer: issuer, uris: []string{authorization.CallerURI, "urn:aerochat:service:chat"}},
		"expired":        {issuer: issuer, uris: []string{authorization.CallerURI}, expired: true},
		"wrong_EKU":      {issuer: issuer, uris: []string{authorization.CallerURI}, server: true},
	} {
		t.Run(name, func(t *testing.T) {
			var pair *tls.Certificate
			if !choice.absent {
				cert, _, _ := privateGroupCertificate(t, choice.issuer, choice.uris, choice.server, choice.expired)
				pair = &cert
			}
			denied := chatauthorizationv1connect.NewInternalAuthorizationServiceClient(privateGroupClient(t, issuer, pair), endpoint)
			req := connect.NewRequest(&chatauthorizationv1.CheckGroupSubjectRequest{GroupId: group, UserId: user})
			req.Header().Set("X-Service-Principal", authorization.CallerURI)
			req.Header().Set("Authorization", "Bearer private-secret-log-marker")
			if response, err := denied.CheckGroupSubject(ctx, req); err == nil || response != nil {
				t.Fatal("untrusted certificate admitted")
			}
		})
	}
	if service.calls.Load() != before {
		t.Fatal("negative TLS reached authoritative domain")
	}
	oldTLS := privateGroupClient(t, issuer, &valid)
	oldConfig := oldTLS.Transport.(*http.Transport).TLSClientConfig
	oldConfig.MinVersion = tls.VersionTLS12
	oldConfig.MaxVersion = tls.VersionTLS12
	oldClient := chatauthorizationv1connect.NewInternalAuthorizationServiceClient(oldTLS, endpoint)
	if response, err := oldClient.CheckGroupSubject(ctx, connect.NewRequest(&chatauthorizationv1.CheckGroupSubjectRequest{GroupId: group, UserId: user})); response != nil || err == nil {
		t.Fatal("TLS1.2 admitted to TLS1.3 boundary")
	}
	large := connect.NewRequest(&chatauthorizationv1.CheckGroupSubjectRequest{GroupId: strings.Repeat("owned-limit-fixture", 500), UserId: user})
	if response, err := client.CheckGroupSubject(ctx, large); response != nil || connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatal("oversized private body admitted")
	}
	if service.calls.Load() != before {
		t.Fatal("protocol or oversized-body denial reached domain")
	}
	public := httptest.NewServer(app.NewHTTPHandler(logger, observability.ServiceMeta{Name: "owned-public"}, func(context.Context) error { return nil }, &chatv1connect.UnimplementedChatServiceHandler{}))
	t.Cleanup(public.Close)
	publicClient := chatauthorizationv1connect.NewInternalAuthorizationServiceClient(public.Client(), public.URL)
	if response, err := publicClient.CheckGroupSubject(ctx, connect.NewRequest(&chatauthorizationv1.CheckGroupSubjectRequest{GroupId: group, UserId: user})); err == nil || response != nil {
		t.Fatal("private route mounted on public Chat")
	}
	publicRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, public.URL+chatauthorizationv1connect.InternalAuthorizationServiceCheckGroupSubjectProcedure, strings.NewReader(""))
	if err != nil {
		t.Fatal(err)
	}
	publicResponse, err := public.Client().Do(publicRequest)
	if err != nil {
		t.Fatal(err)
	}
	_ = publicResponse.Body.Close()
	if publicResponse.StatusCode != http.StatusNotFound {
		t.Fatalf("public route status=%d", publicResponse.StatusCode)
	}
	raw := httptest.NewServer(authorization.NewHTTPHandler(logger, service))
	t.Cleanup(raw.Close)
	rawClient := chatauthorizationv1connect.NewInternalAuthorizationServiceClient(raw.Client(), raw.URL)
	spoof := connect.NewRequest(&chatauthorizationv1.CheckGroupSubjectRequest{GroupId: group, UserId: user})
	spoof.Header().Set("X-Service-Principal", authorization.CallerURI)
	spoof.Header().Set("Authorization", "Bearer private-secret-log-marker")
	if response, err := rawClient.CheckGroupSubject(ctx, spoof); err == nil || response != nil || connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatal("raw HTTP/header spoof admitted")
	}
	rawRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, raw.URL+chatauthorizationv1connect.InternalAuthorizationServiceCheckGroupSubjectProcedure, strings.NewReader(""))
	if err != nil {
		t.Fatal(err)
	}
	rawRequest.Header.Set("X-Service-Principal", authorization.CallerURI)
	rawRequest.Header.Set("Authorization", "Bearer private-secret-log-marker")
	rawResponse, err := raw.Client().Do(rawRequest)
	if err != nil {
		t.Fatal(err)
	}
	_ = rawResponse.Body.Close()
	if rawResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("raw HTTP status=%d", rawResponse.StatusCode)
	}
	if service.calls.Load() != before {
		t.Fatal("public or raw HTTP reached domain")
	}
	if strings.Contains(logs.text(), "private-secret-log-marker") || strings.Contains(logs.text(), group) || strings.Contains(logs.text(), user) {
		t.Fatal("private subject/credential leaked into logs")
	}
}
