package postgres

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"connectrpc.com/connect"
	cpb "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1"
	ia "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/authorization/v1"
	iac "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/authorization/v1/identityauthorizationv1connect"
	ipb "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1"
	rpb "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1"
	rc "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1/rtcv1connect"
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/app"
	control "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediacontrol"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/downstream"
	transport "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/transport/connect"
	"github.com/google/uuid"
	"log/slog"
)

func TestPrivateControlAuthorityClientActualTLSBoundary(t *testing.T) {
	f := publicControlNative(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := f.authority.CheckBound(ctx, f.a.subject); err != nil {
		t.Fatal("actual bound source failed")
	}
	if _, err := f.authority.CheckGroup(ctx, f.group, f.a.subject.UserID); err != nil {
		t.Fatal("actual group source failed")
	}
	for _, change := range []func(*downstream.PrivateAuthorityConfig){func(c *downstream.PrivateAuthorityConfig) { c.IdentityBaseURL = "http://127.0.0.1:9" }, func(c *downstream.PrivateAuthorityConfig) { c.IdentityBaseURL += "?caller=rtc" }, func(c *downstream.PrivateAuthorityConfig) { c.TLSCertFile = "" }} {
		cfg := f.config
		change(&cfg)
		if _, err := downstream.NewPrivateAuthorityClient(cfg); !errors.Is(err, control.ErrUnavailable) {
			t.Fatal("unsafe private constructor accepted")
		}
	}
	for _, spec := range []struct {
		name                string
		ca                  receiverCA
		uris                []string
		expired, wrongUsage bool
	}{{"wrong_uri", newReceiverCA(t), []string{"urn:aerochat:service:identity"}, false, false}, {"ambiguous_uri", newReceiverCA(t), []string{"urn:aerochat:service:rtc-control", "urn:aerochat:service:identity"}, false, false}, {"expired", newReceiverCA(t), []string{"urn:aerochat:service:rtc-control"}, true, false}, {"wrong_usage", newReceiverCA(t), []string{"urn:aerochat:service:rtc-control"}, false, true}} {
		t.Run(spec.name, func(t *testing.T) {
			_, cert, key := receiverLeaf(t, spec.ca, spec.uris, false, spec.expired, spec.wrongUsage)
			dir := t.TempDir()
			cfg := f.config
			cfg.TLSCertFile = filepath.Join(dir, "leaf.pem")
			cfg.TLSKeyFile = filepath.Join(dir, "key.pem")
			_ = os.WriteFile(cfg.TLSCertFile, cert, 0600)
			_ = os.WriteFile(cfg.TLSKeyFile, key, 0600)
			if _, err := downstream.NewPrivateAuthorityClient(cfg); !errors.Is(err, control.ErrUnavailable) {
				t.Fatal("bad RTC leaf accepted")
			}
		})
	}
	wrongCA := newReceiverCA(t)
	wrongDir := t.TempDir()
	wrongPath := filepath.Join(wrongDir, "wrong-ca.pem")
	if os.WriteFile(wrongPath, wrongCA.pem, 0600) != nil {
		t.Fatal("owned wrong CA fixture")
	}
	wrongConfig := f.config
	wrongConfig.ServerCAFile = wrongPath
	wrongClient, err := downstream.NewPrivateAuthorityClient(wrongConfig)
	if err != nil {
		t.Fatal("valid wrong CA fixture did not reach transport")
	}
	wrongCtx, wrongCancel := context.WithTimeout(context.Background(), time.Second)
	_, err = wrongClient.Resolve(wrongCtx, f.a.token)
	wrongCancel()
	wrongClient.Close()
	if !errors.Is(err, control.ErrUnavailable) {
		t.Fatal("untrusted server chain accepted")
	}
	roots := x509.NewCertPool()
	data, err := os.ReadFile(f.config.ServerCAFile)
	if err != nil || !roots.AppendCertsFromPEM(data) {
		t.Fatal("owned CA read")
	}
	validPair, err := tls.LoadX509KeyPair(f.config.TLSCertFile, f.config.TLSKeyFile)
	if err != nil {
		t.Fatal("owned RTC leaf load")
	}
	foreignPair, _, _ := receiverLeaf(t, wrongCA, []string{"urn:aerochat:service:rtc-control"}, false, false, false)
	trustedWrongURI, _, _ := receiverLeaf(t, f.ca, []string{"urn:aerochat:service:identity"}, false, false, false)
	trustedAmbiguousURI, _, _ := receiverLeaf(t, f.ca, []string{"urn:aerochat:service:rtc-control", "urn:aerochat:service:identity"}, false, false, false)
	trustedWrongUsage, _, _ := receiverLeaf(t, f.ca, []string{"urn:aerochat:service:rtc-control"}, false, false, true)
	for _, cfg := range []*tls.Config{{RootCAs: roots, Certificates: []tls.Certificate{trustedWrongURI}, MinVersion: tls.VersionTLS13}, {RootCAs: roots, Certificates: []tls.Certificate{trustedAmbiguousURI}, MinVersion: tls.VersionTLS13}, {RootCAs: roots, Certificates: []tls.Certificate{trustedWrongUsage}, MinVersion: tls.VersionTLS13}, {RootCAs: roots, Certificates: []tls.Certificate{foreignPair}, MinVersion: tls.VersionTLS13}, {RootCAs: roots, MinVersion: tls.VersionTLS13}, {RootCAs: roots, Certificates: []tls.Certificate{validPair}, MinVersion: tls.VersionTLS12, MaxVersion: tls.VersionTLS12}, {RootCAs: roots, Certificates: []tls.Certificate{validPair}, MinVersion: tls.VersionTLS13, ServerName: "wrong.invalid"}} {
		tr := &http.Transport{TLSClientConfig: cfg}
		client := iac.NewInternalAuthorizationServiceClient(&http.Client{Transport: tr, Timeout: time.Second}, f.config.IdentityBaseURL)
		caseCtx, caseCancel := context.WithTimeout(context.Background(), time.Second)
		_, err := client.ResolveSessionBearer(caseCtx, controlNativeRequest(&ia.ResolveSessionBearerRequest{}, f.a.token))
		caseCancel()
		if err == nil {
			t.Fatal("absent client leaf/TLS1.2 accepted")
		}
		tr.CloseIdleConnections()
	}
	controlNativeClientExpiry(t, f)
	controlNativeRedirect(t, f)
}
func TestOwnMediaControlStatusFreshIdentityOnly(t *testing.T) {
	f := publicControlNative(t)
	call, _ := f.held(t, f.a)
	response, err := f.client.RequestGroupMediaLeave(context.Background(), controlNativeRequest(&rpb.RequestGroupMediaLeaveRequest{CallId: call.String(), RequestId: uuid.NewString()}, f.a.token))
	if err != nil {
		t.Fatal("actual own Leave failed")
	}
	requireControlPending(t, response.Msg.Operation)
	controlNativeKeepalive(t, f, response.Msg.Operation.OperationId)
	if _, err := f.chat.TransferGroupOwnership(context.Background(), controlNativeRequest(&cpb.TransferGroupOwnershipRequest{GroupId: f.group.String(), TargetUserId: f.b.subject.UserID.String()}, f.a.token)); err != nil {
		t.Fatal("actual transfer failed")
	}
	if _, err := f.chat.RemoveGroupMember(context.Background(), controlNativeRequest(&cpb.RemoveGroupMemberRequest{GroupId: f.group.String(), UserId: f.a.subject.UserID.String()}, f.b.token)); err != nil {
		t.Fatal("actual remove failed")
	}
	before := f.chatCalls(t)
	rows := f.rows(t)
	status, err := f.client.GetGroupMediaOperation(context.Background(), controlNativeRequest(&rpb.GetGroupMediaOperationRequest{OperationId: response.Msg.Operation.OperationId}, f.a.token))
	if err != nil {
		t.Fatal("removed own status denied")
	}
	requireControlPending(t, status.Msg.Operation)
	if f.chatCalls(t) != before || f.rows(t) != rows {
		t.Fatal("own status touched Chat/RTC targets")
	}
	if _, err := f.client.GetGroupMediaOperation(context.Background(), controlNativeRequest(&rpb.GetGroupMediaOperationRequest{OperationId: uuid.NewString()}, f.a.token)); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatal("missing operation exposed scoped detail")
	}
	if f.chatCalls(t) != before || f.rows(t) != rows {
		t.Fatal("missing own operation called Chat/mutated targets")
	}
	missingBearer := "v1." + uuid.NewString() + "." + strings.Repeat("A", 43)
	if _, err := f.client.GetGroupMediaOperation(context.Background(), controlNativeRequest(&rpb.GetGroupMediaOperationRequest{OperationId: response.Msg.Operation.OperationId}, missingBearer)); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatal("nonexistent opaque session accepted")
	}
	var oldConnection net.Conn
	traceContext := func() (context.Context, context.CancelFunc) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		return httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{GotConn: func(info httptrace.GotConnInfo) {
			if oldConnection != nil && (info.Conn != oldConnection || !info.Reused) {
				t.Error("revocation check did not reuse the verified private TLS connection")
			}
			oldConnection = info.Conn
		}}), cancel
	}
	activeCtx, activeCancel := traceContext()
	if _, err := f.authority.Resolve(activeCtx, f.a.token); err != nil {
		t.Fatal("actual active private bearer")
	}
	activeCancel()
	if oldConnection == nil {
		t.Fatal("actual private TLS trace absent")
	}
	if _, err := f.identity.LogoutCurrentSession(context.Background(), controlNativeRequest(&ipb.LogoutCurrentSessionRequest{}, f.a.token)); err != nil {
		t.Fatal("actual logout failed")
	}
	revokedCtx, revokedCancel := traceContext()
	if _, err := f.authority.Resolve(revokedCtx, f.a.token); !errors.Is(err, control.ErrUnauthenticated) {
		t.Fatal("same TLS connection cached revoked bearer")
	}
	revokedCancel()
	if _, err := f.client.GetGroupMediaOperation(context.Background(), controlNativeRequest(&rpb.GetGroupMediaOperationRequest{OperationId: response.Msg.Operation.OperationId}, f.a.token)); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatal("revoked opaque bearer accepted")
	}
	fresh := f.login(t, f.a)
	if _, err := f.client.GetGroupMediaOperation(context.Background(), controlNativeRequest(&rpb.GetGroupMediaOperationRequest{OperationId: response.Msg.Operation.OperationId}, fresh.token)); err != nil {
		t.Fatal("new active own session denied")
	}
	f.stopChat()
	calls := f.chatCalls(t)
	if _, err := f.client.GetGroupMediaOperation(context.Background(), controlNativeRequest(&rpb.GetGroupMediaOperationRequest{OperationId: response.Msg.Operation.OperationId}, fresh.token)); err != nil {
		t.Fatal("Chat outage blocked identity-only own history")
	}
	if f.chatCalls(t) != calls {
		t.Fatal("own history attempted unavailable Chat")
	}
	newest := f.login(t, f.a)
	if _, err := f.identity.RevokeSessionOrDevice(context.Background(), controlNativeRequest(&ipb.RevokeSessionOrDeviceRequest{Target: &ipb.RevokeSessionOrDeviceRequest_DeviceId{DeviceId: fresh.subject.DeviceID.String()}}, newest.token)); err != nil {
		t.Fatal("actual device revoke failed")
	}
	if _, err := f.client.GetGroupMediaOperation(context.Background(), controlNativeRequest(&rpb.GetGroupMediaOperationRequest{OperationId: response.Msg.Operation.OperationId}, fresh.token)); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatal("revoked device bearer accepted")
	}

}
func TestOwnMediaControlSavedLeaveReplayFromNewSession(t *testing.T) {
	f := publicControlNative(t)
	call, g := f.held(t, f.a)
	request := uuid.NewString()
	old, err := f.client.RequestGroupMediaLeave(context.Background(), controlNativeRequest(&rpb.RequestGroupMediaLeaveRequest{CallId: call.String(), RequestId: request}, f.a.token))
	if err != nil {
		t.Fatal("actual old leave failed")
	}
	// Это MODEL journal ACK для replacement fixture, не provider proof.
	controlCompleteChild(t, f.store, g)
	if _, err := f.coordinator.Finalize(context.Background(), uuid.MustParse(old.Msg.Operation.OperationId), time.Now()); err != nil {
		t.Fatal("owned model finalizer")
	}
	if _, err := f.identity.LogoutCurrentSession(context.Background(), controlNativeRequest(&ipb.LogoutCurrentSessionRequest{}, f.a.token)); err != nil {
		t.Fatal("actual old session logout failed")
	}
	if _, err := f.client.RequestGroupMediaLeave(context.Background(), controlNativeRequest(&rpb.RequestGroupMediaLeaveRequest{CallId: call.String(), RequestId: request}, f.a.token)); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatal("old revoked saved bearer accepted")
	}
	fresh := f.login(t, f.a)
	group, err := f.chat.CreateGroup(context.Background(), controlNativeRequest(&cpb.CreateGroupRequest{Name: "Owned replacement group"}, fresh.token))
	if err != nil {
		t.Fatal("actual replacement group")
	}
	f.group = uuid.MustParse(group.Msg.Group.Id)
	_, replacement := f.held(t, fresh)
	before := f.rows(t)
	calls := f.chatCalls(t)
	replay, err := f.client.RequestGroupMediaLeave(context.Background(), controlNativeRequest(&rpb.RequestGroupMediaLeaveRequest{CallId: call.String(), RequestId: request}, fresh.token))
	if err != nil || replay.Msg.Operation.OperationId != old.Msg.Operation.OperationId {
		t.Fatal("saved Leave retargeted")
	}
	requireControlPending(t, replay.Msg.Operation)
	if before != f.rows(t) || f.chatCalls(t) != calls || guardCount(t, f.db, "SELECT count(*) FROM rtc_media_grants WHERE id=$1 AND state='prepared'", replacement.GrantID) != 1 {
		t.Fatal("readonly replay changed targets/replacement")
	}
	if _, err := f.client.RequestGroupMediaLeave(context.Background(), controlNativeRequest(&rpb.RequestGroupMediaLeaveRequest{CallId: uuid.NewString(), RequestId: request}, fresh.token)); connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatal("changed saved call accepted")
	}
	if _, err := f.client.GetGroupMediaOperation(context.Background(), controlNativeRequest(&rpb.GetGroupMediaOperationRequest{OperationId: old.Msg.Operation.OperationId}, f.b.token)); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatal("foreign operation capability")
	}
}
func TestPublicMediaControlNewLeaveExactHeldBinding(t *testing.T) {
	f := publicControlNative(t)
	call, _ := f.held(t, f.b)
	fresh := f.login(t, f.b)
	before := f.rows(t)
	calls := f.chatCalls(t)
	if _, err := f.client.RequestGroupMediaLeave(context.Background(), controlNativeRequest(&rpb.RequestGroupMediaLeaveRequest{CallId: call.String(), RequestId: uuid.NewString()}, fresh.token)); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatal("new device targeted old held tuple")
	}
	if f.rows(t) != before || f.chatCalls(t) != calls {
		t.Fatal("wrong held tuple caused source/mutation")
	}
	if _, err := f.client.RequestGroupMediaLeave(context.Background(), controlNativeRequest(&rpb.RequestGroupMediaLeaveRequest{CallId: uuid.NewString(), RequestId: uuid.NewString()}, f.b.token)); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatal("nonexistent call targeted held grant")
	}
	if f.rows(t) != before || f.chatCalls(t) != calls {
		t.Fatal("wrong call caused Chat/journal work")
	}
	if _, err := f.chat.UpdateGroupMemberRole(context.Background(), controlNativeRequest(&cpb.UpdateGroupMemberRoleRequest{GroupId: f.group.String(), UserId: f.b.subject.UserID.String(), Role: cpb.GroupMemberRole_GROUP_MEMBER_ROLE_READER}, f.a.token)); err != nil {
		t.Fatal("actual reader transition")
	}
	response, err := f.client.RequestGroupMediaLeave(context.Background(), controlNativeRequest(&rpb.RequestGroupMediaLeaveRequest{CallId: call.String(), RequestId: uuid.NewString()}, f.b.token))
	if err != nil {
		t.Fatal("genuine reader own Leave denied")
	}
	requireControlPending(t, response.Msg.Operation)
	if _, err := f.chat.RemoveGroupMember(context.Background(), controlNativeRequest(&cpb.RemoveGroupMemberRequest{GroupId: f.group.String(), UserId: f.b.subject.UserID.String()}, f.a.token)); err != nil {
		t.Fatal("actual removed transition failed")
	}
	removed, err := f.client.RequestGroupMediaLeave(context.Background(), controlNativeRequest(&rpb.RequestGroupMediaLeaveRequest{CallId: call.String(), RequestId: uuid.NewString()}, f.b.token))
	if err != nil {
		t.Fatal("genuine removed self teardown denied")
	}
	requireControlPending(t, removed.Msg.Operation)
	f.stopChat()
	before = f.rows(t)
	calls = f.authority.group.Load()
	if _, err := f.client.RequestGroupMediaLeave(context.Background(), controlNativeRequest(&rpb.RequestGroupMediaLeaveRequest{CallId: call.String(), RequestId: uuid.NewString()}, f.b.token)); connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatal("Chat outage fabricated removal authorization")
	}
	if f.rows(t) != before || f.authority.group.Load() != calls+1 {
		t.Fatal("unavailable source mutated new Leave")
	}
}
func TestPublicMediaControlEndFreshCreatorAndCurrentEligibility(t *testing.T) {
	f := publicControlNative(t)
	call, _ := f.held(t, f.a)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	originalFacts, err := f.authority.CheckGroup(ctx, f.group, f.a.subject.UserID)
	if err != nil {
		t.Fatal("actual original creator facts")
	}
	if _, err := f.chat.TransferGroupOwnership(context.Background(), controlNativeRequest(&cpb.TransferGroupOwnershipRequest{GroupId: f.group.String(), TargetUserId: f.b.subject.UserID.String()}, f.a.token)); err != nil {
		t.Fatal("actual transfer")
	}
	if _, err := f.client.RequestGroupMediaEnd(context.Background(), controlNativeRequest(&rpb.RequestGroupMediaEndRequest{CallId: call.String(), RequestId: uuid.NewString()}, f.b.token)); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatal("other current owner ended call")
	}
	currentFacts, err := f.authority.CheckGroup(ctx, f.group, f.a.subject.UserID)
	if err != nil || currentFacts.Epoch != originalFacts.Epoch || currentFacts.Role == originalFacts.Role {
		t.Fatal("actual eligible role change with same epoch absent")
	}
	request := uuid.NewString()
	response, err := f.client.RequestGroupMediaEnd(context.Background(), controlNativeRequest(&rpb.RequestGroupMediaEndRequest{CallId: call.String(), RequestId: request}, f.a.token))
	if err != nil {
		t.Fatal("fresh eligible creator denied")
	}
	requireControlPending(t, response.Msg.Operation)
	if _, err := f.chat.UpdateGroupMemberRole(context.Background(), controlNativeRequest(&cpb.UpdateGroupMemberRoleRequest{GroupId: f.group.String(), UserId: f.a.subject.UserID.String(), Role: cpb.GroupMemberRole_GROUP_MEMBER_ROLE_READER}, f.b.token)); err != nil {
		t.Fatal("actual creator reader transition")
	}
	for _, status := range []bool{false, true} {
		var err error
		if status {
			_, err = f.client.GetGroupMediaOperation(context.Background(), controlNativeRequest(&rpb.GetGroupMediaOperationRequest{OperationId: response.Msg.Operation.OperationId}, f.a.token))
		} else {
			_, err = f.client.RequestGroupMediaEnd(context.Background(), controlNativeRequest(&rpb.RequestGroupMediaEndRequest{CallId: call.String(), RequestId: request}, f.a.token))
		}
		if connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatal("End replay/status cached eligible role")
		}
	}
	before := f.rows(t)
	if _, err := f.chat.RemoveGroupMember(context.Background(), controlNativeRequest(&cpb.RemoveGroupMemberRequest{GroupId: f.group.String(), UserId: f.a.subject.UserID.String()}, f.b.token)); err != nil {
		t.Fatal("actual creator remove")
	}
	if _, err := f.client.RequestGroupMediaEnd(context.Background(), controlNativeRequest(&rpb.RequestGroupMediaEndRequest{CallId: call.String(), RequestId: request}, f.a.token)); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatal("removed creator replay accepted")
	}
	if _, err := f.client.GetGroupMediaOperation(context.Background(), controlNativeRequest(&rpb.GetGroupMediaOperationRequest{OperationId: response.Msg.Operation.OperationId}, f.a.token)); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatal("removed creator End status accepted")
	}
	if f.rows(t) != before {
		t.Fatal("denied End changed journal")
	}
}
func TestPublicMediaControlTotalDeadlineCancellationAndLostResponse(t *testing.T) {
	f := publicControlNative(t)
	controlNativeBodyBudgets(t, f)
	controlNativeOpaqueWriter(t, f)
	call, _ := f.held(t, f.a)
	controlNativeGuardRollbacks(t, f, call)
	controlNativeHeldDeadline(t, f, call)
	controlNativeFinalSourceDeadline(t, f, call)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	blocker, err := f.db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackMedia(blocker)
	if _, err := blocker.Exec(ctx, "SELECT id FROM rtc_calls WHERE id=$1 FOR UPDATE", call); err != nil {
		t.Fatal(err)
	}
	attempt, stop := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() {
		_, err := f.client.RequestGroupMediaEnd(attempt, controlNativeRequest(&rpb.RequestGroupMediaEndRequest{CallId: call.String(), RequestId: uuid.NewString()}, f.a.token))
		done <- err
	}()
	waitForMediaLock(t, ctx, f.db, f.db.Config().ConnConfig.RuntimeParams["application_name"])
	stop()
	select {
	case err := <-done:
		if connect.CodeOf(err) != connect.CodeCanceled {
			t.Fatal("precommit cancellation lost")
		}
	case <-time.After(6 * time.Second):
		t.Fatal("owned canceled request hung")
	}
	if err := blocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if guardCount(t, f.db, "SELECT count(*) FROM rtc_media_control_intents WHERE call_id=$1", call) != 0 {
		t.Fatal("canceled precommit created intent")
	}
	request := uuid.NewString()
	base := &http.Transport{}
	t.Cleanup(base.CloseIdleConnections)
	loss := &lostReceiverResponse{inner: base}
	loss.drop.Store(true)
	client := rc.NewGroupMediaControlServiceClient(&http.Client{Transport: loss, Timeout: 6 * time.Second}, f.publicURL)
	if _, err := client.RequestGroupMediaEnd(ctx, controlNativeRequest(&rpb.RequestGroupMediaEndRequest{CallId: call.String(), RequestId: request}, f.a.token)); err == nil {
		t.Fatal("controlled response loss not exercised")
	}
	if guardCount(t, f.db, "SELECT count(*) FROM rtc_media_control_intents WHERE request_id=$1", uuid.MustParse(request)) != 1 {
		t.Fatal("lost response not after commit")
	}
	before := f.rows(t)
	replay, err := f.client.RequestGroupMediaEnd(ctx, controlNativeRequest(&rpb.RequestGroupMediaEndRequest{CallId: call.String(), RequestId: request}, f.a.token))
	if err != nil {
		t.Fatal("actual lost-response replay failed")
	}
	requireControlPending(t, replay.Msg.Operation)
	if before != f.rows(t) {
		t.Fatal("replay mutated immutable targets")
	}
	controlNativeSavedCommitGuard(t, f, call, uuid.MustParse(request))
}
func TestPublicMediaControlUnknownProviderNeverComplete(t *testing.T) {
	f := publicControlNative(t)
	emptyCall := f.emptyCall(t, f.a)
	empty, err := f.client.RequestGroupMediaEnd(context.Background(), controlNativeRequest(&rpb.RequestGroupMediaEndRequest{CallId: emptyCall.String(), RequestId: uuid.NewString()}, f.a.token))
	if err != nil {
		t.Fatal("actual empty UNKNOWN request")
	}
	requireControlPending(t, empty.Msg.Operation)
	if guardCount(t, f.db, "SELECT count(*) FROM rtc_media_control_intents WHERE id=$1 AND resolution='unknown'", uuid.MustParse(empty.Msg.Operation.OperationId)) != 1 {
		t.Fatal("empty UNKNOWN fixture not exercised")
	}
	group, err := f.chat.CreateGroup(context.Background(), controlNativeRequest(&cpb.CreateGroupRequest{Name: "Owned model completion group"}, f.a.token))
	if err != nil {
		t.Fatal("actual completion group")
	}
	f.group = uuid.MustParse(group.Msg.Group.Id)
	call, g := f.held(t, f.a)
	response, err := f.client.RequestGroupMediaLeave(context.Background(), controlNativeRequest(&rpb.RequestGroupMediaLeaveRequest{CallId: call.String(), RequestId: uuid.NewString()}, f.a.token))
	if err != nil {
		t.Fatal(err)
	}
	controlCompleteChild(t, f.store, g)
	if _, err := f.coordinator.Finalize(context.Background(), uuid.MustParse(response.Msg.Operation.OperationId), time.Now()); err != nil {
		t.Fatal("owned model complete fixture")
	}
	statusRequest := controlNativeRequest(&rpb.GetGroupMediaOperationRequest{OperationId: response.Msg.Operation.OperationId}, f.a.token)
	statusRequest.Header().Set("X-Aero-Media-Outcome", "complete")
	status, err := f.client.GetGroupMediaOperation(context.Background(), statusRequest)
	if err != nil {
		t.Fatal(err)
	}
	requireControlPending(t, status.Msg.Operation)
	if guardCount(t, f.db, "SELECT count(*) FROM rtc_media_control_intents WHERE id=$1 AND state='complete'", uuid.MustParse(response.Msg.Operation.OperationId)) != 1 {
		t.Fatal("model completion fixture not exercised")
	}
}
func TestAuthorizedGroupMediaControlFactoryRemainsUnmounted(t *testing.T) {
	f := publicControlNative(t)
	f.stopSources()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := transport.NewHandler("owned-off-mode", "native", nil)
	legacy := app.NewHTTPHandler(logger, observability.ServiceMeta{Name: "owned-off-mode", Version: "native"}, nil, handler)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: legacy, ReadHeaderTimeout: time.Second}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Close() })
	request, err := http.NewRequest(http.MethodPost, "http://"+listener.Addr().String()+rc.GroupMediaControlServiceRequestGroupMediaLeaveProcedure, strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := controlNativeHTTPClient(t, time.Second).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatal("production app mounted authorized group control")
	}
	if _, err := handler.RequestGroupMediaLeave(context.Background(), connect.NewRequest(&rpb.RequestGroupMediaLeaveRequest{})); connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatal("legacy stub replaced")
	}
	if _, err := handler.RequestGroupMediaEnd(context.Background(), connect.NewRequest(&rpb.RequestGroupMediaEndRequest{})); connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatal("legacy End stub replaced")
	}
	if _, err := handler.GetGroupMediaOperation(context.Background(), connect.NewRequest(&rpb.GetGroupMediaOperationRequest{})); connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatal("legacy status stub replaced")
	}
	t.Log("Gateway route absence source-inspected only; actual Gateway phase UNRUN, not counted as native404")
}

func controlNativeBodyBudgets(t *testing.T, f *publicControlNativeFixture) {
	t.Helper()
	target, err := url.Parse(f.publicURL)
	if err != nil {
		t.Fatal("owned control URL")
	}
	before := f.authority.resolve.Load()
	for _, headers := range [][]string{{}, {"Basic invalid"}, {"Bearer "}, {"Bearer a,b"}, {"Bearer " + f.a.token, "Bearer " + f.a.token}} {
		largeHeader, err := http.NewRequest(http.MethodPost, f.publicURL+rc.GroupMediaControlServiceRequestGroupMediaLeaveProcedure, strings.NewReader(`{}`))
		if err != nil {
			t.Fatal(err)
		}
		largeHeader.Header.Set("Authorization", "Bearer "+f.a.token)
		largeHeader.Header.Set("X-Owned-Header", strings.Repeat("x", 16384))
		headerResponse, err := (controlNativeHTTPClient(t, 6*time.Second)).Do(largeHeader)
		if err != nil {
			t.Fatal("owned oversized header response")
		}
		_ = headerResponse.Body.Close()
		if headerResponse.StatusCode != http.StatusRequestHeaderFieldsTooLarge || f.authority.resolve.Load() != before {
			t.Fatal("oversized raw header reached authority")
		}
		request, err := http.NewRequest(http.MethodPost, f.publicURL+rc.GroupMediaControlServiceRequestGroupMediaLeaveProcedure, strings.NewReader(`{"callId":"`+uuid.NewString()+`","requestId":"`+uuid.NewString()+`"}`))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Content-Type", "application/json")
		for _, header := range headers {
			request.Header.Add("Authorization", header)
		}
		response, err := (controlNativeHTTPClient(t, 6*time.Second)).Do(request)
		if err != nil {
			t.Fatal("owned header negative transport")
		}
		_, _ = io.Copy(io.Discard, response.Body)
		_ = response.Body.Close()
		if response.StatusCode != http.StatusUnauthorized || !response.Close || f.authority.resolve.Load() != before {
			t.Fatal("ambiguous/malformed native header reached authority")
		}
	}
	for _, kind := range []string{"raw_header", "body_decode"} {
		t.Run(kind, func(t *testing.T) {
			conn, err := net.DialTimeout("tcp", target.Host, time.Second)
			if err != nil {
				t.Fatal("owned raw client")
			}
			defer conn.Close()
			_ = conn.SetDeadline(time.Now().Add(7 * time.Second))
			started := time.Now()
			if kind == "raw_header" {
				_, err = io.WriteString(conn, "POST "+rc.GroupMediaControlServiceRequestGroupMediaLeaveProcedure+" HTTP/1.1\r\nHost: "+target.Host+"\r\n")
			} else {
				_, err = io.WriteString(conn, "POST "+rc.GroupMediaControlServiceRequestGroupMediaLeaveProcedure+" HTTP/1.1\r\nHost: "+target.Host+"\r\nAuthorization: Bearer "+f.a.token+"\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{\"callId\":")
			}
			if err != nil {
				t.Fatal("owned raw write")
			}
			buffer := make([]byte, 1024)
			_, _ = conn.Read(buffer)
			elapsed := time.Since(started)
			limit := 6 * time.Second
			if kind == "raw_header" {
				limit = 2 * time.Second
			}
			if elapsed > limit || f.authority.resolve.Load() != before {
				t.Fatal("raw phase exceeded budget/reached authority")
			}
		})
	}
	request, err := http.NewRequest(http.MethodPost, f.publicURL+rc.GroupMediaControlServiceRequestGroupMediaLeaveProcedure, strings.NewReader(strings.Repeat("x", 4097)))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+f.a.token)
	request.Header.Set("Content-Type", "application/json")
	response, err := (controlNativeHTTPClient(t, 6*time.Second)).Do(request)
	if err != nil {
		t.Fatal("owned cap request failed before response")
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusBadRequest || f.authority.resolve.Load() != before {
		t.Fatal("raw body cap reached source")
	}
	var zipped bytes.Buffer
	zip := gzip.NewWriter(&zipped)
	_, err = zip.Write([]byte(`{"callId":"` + strings.Repeat("x", 8192) + `","requestId":"` + uuid.NewString() + `"}`))
	if err != nil || zip.Close() != nil {
		t.Fatal("owned gzip fixture")
	}
	if zipped.Len() >= 4096 {
		t.Fatal("owned gzip did not exercise below-raw-cap path")
	}
	compressedRequest, err := http.NewRequest(http.MethodPost, f.publicURL+rc.GroupMediaControlServiceRequestGroupMediaLeaveProcedure, bytes.NewReader(zipped.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	compressedRequest.Header.Set("Authorization", "Bearer "+f.a.token)
	compressedRequest.Header.Set("Content-Type", "application/json")
	compressedRequest.Header.Set("Content-Encoding", "gzip")
	compressedRequest.Header.Set("Connect-Protocol-Version", "1")
	compressedResponse, err := (controlNativeHTTPClient(t, 6*time.Second)).Do(compressedRequest)
	if err != nil {
		t.Fatal("owned gzip response")
	}
	_ = compressedResponse.Body.Close()
	if compressedResponse.StatusCode != http.StatusRequestEntityTooLarge || f.authority.resolve.Load() != before {
		t.Fatal("oversized decoded gzip reached source/domain")
	}
}
func controlNativeKeepalive(t *testing.T, f *publicControlNativeFixture, operation string) {
	t.Helper()
	target, err := url.Parse(f.publicURL)
	if err != nil {
		t.Fatal(err)
	}
	conn, err := net.DialTimeout("tcp", target.Host, time.Second)
	if err != nil {
		t.Fatal("owned keepalive dial")
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(12 * time.Second))
	reader := bufio.NewReader(conn)
	for i := 0; i < 2; i++ {
		if i == 1 {
			time.Sleep(5200 * time.Millisecond)
		}
		body := `{"operationId":"` + operation + `"}`
		_, err := fmt.Fprintf(conn, "POST %s HTTP/1.1\r\nHost: %s\r\nAuthorization: Bearer %s\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s", rc.GroupMediaControlServiceGetGroupMediaOperationProcedure, target.Host, f.a.token, len(body), body)
		if err != nil {
			t.Fatal("valid owned keepalive write")
		}
		response, err := http.ReadResponse(reader, &http.Request{Method: http.MethodPost})
		if err != nil {
			t.Fatal("read deadline poisoned next request")
		}
		_, err = io.Copy(io.Discard, response.Body)
		_ = response.Body.Close()
		if err != nil || response.StatusCode != http.StatusOK || response.Close {
			t.Fatal("valid EOF keepalive closed")
		}
	}
}

// Прозрачность writer намеренно отсутствует; finite server fallback остаётся настоящим.
type controlOpaqueWriter struct{ inner http.ResponseWriter }

func (w controlOpaqueWriter) Header() http.Header            { return w.inner.Header() }
func (w controlOpaqueWriter) WriteHeader(code int)           { w.inner.WriteHeader(code) }
func (w controlOpaqueWriter) Write(data []byte) (int, error) { return w.inner.Write(data) }

func controlNativeOpaqueWriter(t *testing.T, f *publicControlNativeFixture) {
	t.Helper()
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
		t.Fatal("owned opaque listener")
	}
	server := &http.Server{ReadHeaderTimeout: time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, MaxHeaderBytes: 8192, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { handler.ServeHTTP(controlOpaqueWriter{inner: w}, r) })}
	go func() { _ = server.Serve(listener) }()
	defer server.Close()
	conn, err := net.DialTimeout("tcp", listener.Addr().String(), time.Second)
	if err != nil {
		t.Fatal("owned opaque connection")
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(6 * time.Second))
	before := f.authority.resolve.Load()
	started := time.Now()
	_, err = fmt.Fprintf(conn, "POST %s HTTP/1.1\r\nHost: %s\r\nAuthorization: Bearer %s\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{", rc.GroupMediaControlServiceRequestGroupMediaLeaveProcedure, listener.Addr().String(), f.a.token)
	if err != nil {
		t.Fatal("owned opaque write")
	}
	response, err := http.ReadResponse(bufio.NewReader(conn), &http.Request{Method: http.MethodPost})
	if err != nil {
		t.Fatal("owned fallback did not produce bounded denial")
	}
	_, _ = io.Copy(io.Discard, response.Body)
	_ = response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable || !response.Close || time.Since(started) > 6*time.Second || f.authority.resolve.Load() != before {
		t.Fatal("unsupported controller decoded/reached authority/reused connection")
	}
}

func controlNativeHeldDeadline(t *testing.T, f *publicControlNativeFixture, call uuid.UUID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	blocker, err := f.db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackMedia(blocker)
	if _, err := blocker.Exec(ctx, "SELECT id FROM rtc_calls WHERE id=$1 FOR UPDATE", call); err != nil {
		t.Fatal(err)
	}
	before := f.rows(t)
	boundBefore := f.authority.bound.Load()
	started := time.Now()
	done := make(chan error, 1)
	go func() {
		_, err := f.client.RequestGroupMediaEnd(ctx, controlNativeRequest(&rpb.RequestGroupMediaEndRequest{CallId: call.String(), RequestId: uuid.NewString()}, f.a.token))
		done <- err
	}()
	waitForMediaLock(t, ctx, f.db, f.db.Config().ConnConfig.RuntimeParams["application_name"])
	if f.authority.bound.Load() != boundBefore+1 {
		t.Fatal("RTC wait did not follow actual final source snapshot")
	}
	select {
	case err := <-done:
		// Write D может не доставить Connect error; success запрещён в любом случае.
		if err == nil || time.Since(started) < 4500*time.Millisecond || time.Since(started) > 6500*time.Millisecond {
			t.Fatal("DB wait renewed/exceeded original request budget")
		}
	case <-time.After(6500 * time.Millisecond):
		t.Fatal("actual lock wait outlived request deadline")
	}
	if err := blocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	controlNativeNoBlocked(t, f)
	if f.rows(t) != before {
		t.Fatal("deadline wait mutated RTC journal")
	}
}
func controlNativeNoBlocked(t *testing.T, f *publicControlNativeFixture) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for {
		var count int
		if err := f.db.QueryRow(ctx, "SELECT count(*) FROM pg_stat_activity WHERE application_name=$1 AND cardinality(pg_blocking_pids(pid))>0", f.db.Config().ConnConfig.RuntimeParams["application_name"]).Scan(&count); err != nil {
			t.Fatal("owned lock cleanup observation")
		}
		if count == 0 {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal("owned request retained blocked backend")
		case <-time.After(10 * time.Millisecond):
		}
	}
}

func controlNativeGuardRollbacks(t *testing.T, f *publicControlNativeFixture, call uuid.UUID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	facts, err := f.authority.CheckGroup(ctx, f.group, f.a.subject.UserID)
	if err != nil || facts.Status != "present" {
		t.Fatal("actual local-guard facts")
	}
	sub := f.a.subject
	actor := control.Actor{UserID: sub.UserID, SessionID: sub.SessionID, DeviceID: sub.DeviceID, SessionRevision: sub.SessionRevision, DeviceRevision: sub.DeviceRevision, IdentityState: control.IdentityActive, GroupID: f.group, Role: facts.Role}
	request := control.Request{ID: uuid.New(), CallID: call, Kind: "end", Actor: actor, At: time.Now()}
	before := f.rows(t)
	if _, err := f.coordinator.RequestAuthorized(ctx, request, nil); !errors.Is(err, control.ErrUnavailable) {
		t.Fatal("nil authorized guard accepted")
	}
	for _, point := range []int{1, 2, 3, 4} {
		t.Run(fmt.Sprintf("new_guard_%d", point), func(t *testing.T) {
			attempt, stop := context.WithTimeout(context.Background(), 5*time.Second)
			defer stop()
			calls := 0
			guard := func(ctx context.Context) error {
				calls++
				if calls == point {
					stop()
				}
				return ctx.Err()
			}
			if _, err := f.coordinator.RequestAuthorized(attempt, request, guard); !errors.Is(err, context.Canceled) || calls != point {
				t.Fatal("required local guard point absent")
			}
			if f.rows(t) != before {
				t.Fatal("guard failure persisted precommit journal changes")
			}
		})
	}
	expired, expire := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer expire()
	if _, err := f.coordinator.RequestAuthorized(expired, request, func(ctx context.Context) error { return ctx.Err() }); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("expired local guard accepted")
	}
	if f.rows(t) != before {
		t.Fatal("nil/expired authorized guard mutated RTC state")
	}
}

func controlNativeSavedCommitGuard(t *testing.T, f *publicControlNativeFixture, call, requestID uuid.UUID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	facts, err := f.authority.CheckGroup(ctx, f.group, f.a.subject.UserID)
	if err != nil {
		t.Fatal("actual replay actor facts")
	}
	sub := f.a.subject
	r := control.Request{ID: requestID, CallID: call, Kind: "end", Actor: control.Actor{UserID: sub.UserID, SessionID: sub.SessionID, DeviceID: sub.DeviceID, SessionRevision: sub.SessionRevision, DeviceRevision: sub.DeviceRevision, IdentityState: control.IdentityActive, GroupID: f.group, Role: facts.Role}, At: time.Now()}
	attempt, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	before := f.rows(t)
	calls := 0
	guard := func(ctx context.Context) error {
		calls++
		if calls == 3 {
			stop()
		}
		return ctx.Err()
	}
	if _, err := f.coordinator.RequestAuthorized(attempt, r, guard); !errors.Is(err, context.Canceled) || calls != 3 {
		t.Fatal("saved replay commit omitted its required local guard")
	}
	if f.rows(t) != before {
		t.Fatal("canceled saved replay changed journal")
	}
}

func controlNativeClientExpiry(t *testing.T, f *publicControlNativeFixture) {
	t.Helper()
	principal, err := url.Parse("urn:aerochat:service:rtc-control")
	if err != nil {
		t.Fatal(err)
	}
	expires := time.Now().Add(3 * time.Second).Truncate(time.Second)
	leaf := &x509.Certificate{SerialNumber: big.NewInt(time.Now().UnixNano()), NotBefore: time.Now().Add(-time.Hour), NotAfter: expires, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}, URIs: []*url.URL{principal}}
	der, err := x509.CreateCertificate(rand.Reader, leaf, f.ca.cert, &f.ca.key.PublicKey, f.ca.key)
	if err != nil {
		t.Fatal("owned expiring RTC certificate")
	}
	key, err := x509.MarshalECPrivateKey(f.ca.key)
	if err != nil {
		t.Fatal("owned leaf key encode")
	}
	dir := t.TempDir()
	cfg := f.config
	cfg.TLSCertFile = filepath.Join(dir, "short.pem")
	cfg.TLSKeyFile = filepath.Join(dir, "short-key.pem")
	if os.WriteFile(cfg.TLSCertFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0600) != nil || os.WriteFile(cfg.TLSKeyFile, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: key}), 0600) != nil {
		t.Fatal("owned short TLS files")
	}
	client, err := downstream.NewPrivateAuthorityClient(cfg)
	if err != nil {
		t.Fatal("owned short TLS constructor")
	}
	defer client.Close()
	var connections atomic.Int64
	var reused atomic.Bool
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ctx = httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{GotConn: func(info httptrace.GotConnInfo) {
		connections.Add(1)
		if info.Reused {
			reused.Store(true)
		}
	}})
	for i := 0; i < 2; i++ {
		if _, err := client.CheckBound(ctx, f.a.subject); err != nil {
			t.Fatal("owned short certificate active source")
		}
	}
	if connections.Load() != 2 || !reused.Load() {
		t.Fatal("actual cached TLS connection not exercised")
	}
	time.Sleep(time.Until(expires.Add(20 * time.Millisecond)))
	before := connections.Load()
	if _, err := client.CheckBound(ctx, f.a.subject); !errors.Is(err, control.ErrUnavailable) {
		t.Fatal("expired leaf reused cached authority transport")
	}
	if connections.Load() != before {
		t.Fatal("expired cached certificate initiated private RPC")
	}
}
func controlNativeRedirect(t *testing.T, f *publicControlNativeFixture) {
	t.Helper()
	pair, err := tls.LoadX509KeyPair(filepath.Join(filepath.Dir(f.config.TLSCertFile), "server.pem"), filepath.Join(filepath.Dir(f.config.TLSCertFile), "server-key.pem"))
	if err != nil {
		t.Fatal("owned redirect TLS")
	}
	roots := x509.NewCertPool()
	roots.AddCert(f.ca.cert)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal("owned redirect listener")
	}
	var calls atomic.Int64
	server := &http.Server{ReadHeaderTimeout: time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, TLSConfig: &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{pair}, ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: roots}, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Redirect(w, r, f.identityURL+"/blocked-redirect", http.StatusTemporaryRedirect)
	})}
	go func() { _ = server.ServeTLS(listener, "", "") }()
	defer server.Close()
	cfg := f.config
	cfg.IdentityBaseURL = "https://" + listener.Addr().String()
	client, err := downstream.NewPrivateAuthorityClient(cfg)
	if err != nil {
		t.Fatal("owned redirect client")
	}
	defer client.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := client.Resolve(ctx, f.a.token); !errors.Is(err, control.ErrUnavailable) || calls.Load() != 1 {
		t.Fatal("actual private TLS redirect was accepted")
	}
}

// Barrier управляет только моментом настоящего RPC; authority facts не подменяются.
type controlFinalBoundAuthority struct {
	inner         *countedActualControlAuthority
	ready, locked chan struct{}
}

func (a *controlFinalBoundAuthority) Resolve(ctx context.Context, bearer string) (control.OwnStatusSubject, error) {
	return a.inner.Resolve(ctx, bearer)
}
func (a *controlFinalBoundAuthority) CheckGroup(ctx context.Context, group, user uuid.UUID) (control.GroupFacts, error) {
	return a.inner.CheckGroup(ctx, group, user)
}
func (a *controlFinalBoundAuthority) CheckBound(ctx context.Context, subject control.OwnStatusSubject) (control.OwnStatusSubject, error) {
	close(a.ready)
	select {
	case <-a.locked:
	case <-ctx.Done():
		return control.OwnStatusSubject{}, ctx.Err()
	}
	return a.inner.CheckBound(ctx, subject)
}
func controlNativeFinalSourceDeadline(t *testing.T, f *publicControlNativeFixture, call uuid.UUID) {
	t.Helper()
	barrier := &controlFinalBoundAuthority{inner: f.authority, ready: make(chan struct{}), locked: make(chan struct{})}
	service, err := control.NewAuthorizedService(f.coordinator, barrier)
	if err != nil {
		t.Fatal(err)
	}
	handler, err := transport.NewAuthorizedGroupMediaControlHTTPHandler(service)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal("owned final-source listener")
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, MaxHeaderBytes: 8192}
	go func() { _ = server.Serve(listener) }()
	defer server.Close()
	client := rc.NewGroupMediaControlServiceClient(controlNativeHTTPClient(t, 6*time.Second), "http://"+listener.Addr().String())
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	before := f.rows(t)
	groupBefore := f.authority.group.Load()
	started := time.Now()
	done := make(chan error, 1)
	go func() {
		_, err := client.RequestGroupMediaEnd(ctx, controlNativeRequest(&rpb.RequestGroupMediaEndRequest{CallId: call.String(), RequestId: uuid.NewString()}, f.a.token))
		done <- err
	}()
	select {
	case <-barrier.ready:
	case <-time.After(2 * time.Second):
		t.Fatal("final source snapshot boundary not reached")
	}
	if f.authority.group.Load() != groupBefore+1 {
		t.Fatal("final bound did not follow genuine Chat facts")
	}
	blocker, err := f.db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackMedia(blocker)
	if _, err := blocker.Exec(ctx, "LOCK TABLE user_sessions IN ACCESS EXCLUSIVE MODE"); err != nil {
		t.Fatal("owned Identity source barrier")
	}
	var ownerPID int
	if err := blocker.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&ownerPID); err != nil {
		t.Fatal(err)
	}
	close(barrier.locked)
	observed := false
	observeUntil := time.Now().Add(2 * time.Second)
	for time.Now().Before(observeUntil) {
		if err := f.db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND query LIKE '%FROM user_sessions AS s%' AND $2=ANY(pg_blocking_pids(pid)))", f.db.Config().ConnConfig.RuntimeParams["application_name"], ownerPID).Scan(&observed); err != nil {
			t.Fatal("actual final source blocker observation")
		}
		if observed {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !observed {
		t.Fatal("final Identity snapshot did not reach actual owned PG blocker")
	}
	select {
	case err := <-done:
		if err == nil || time.Since(started) < 4500*time.Millisecond || time.Since(started) > 6500*time.Millisecond {
			t.Fatal("final source wait renewed original request D")
		}
	case <-time.After(6500 * time.Millisecond):
		t.Fatal("final source snapshot outlived original D")
	}
	if err := blocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	controlNativeNoBlocked(t, f)
	if f.rows(t) != before {
		t.Fatal("expired final source snapshot reached RTC mutation")
	}
	t.Log("rtc_auth_actual_final_source_pg_barrier=true")
}
