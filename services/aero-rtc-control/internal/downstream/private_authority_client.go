package downstream

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"

	"connectrpc.com/connect"
	cpb "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/authorization/v1"
	cc "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/authorization/v1/chatauthorizationv1connect"
	ipb "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/authorization/v1"
	ic "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/authorization/v1/identityauthorizationv1connect"
	control "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediacontrol"
	"github.com/google/uuid"
)

type PrivateAuthorityConfig struct {
	IdentityBaseURL, ChatBaseURL          string
	ServerCAFile, TLSCertFile, TLSKeyFile string
}

type PrivateAuthorityClient struct {
	identity     ic.InternalAuthorizationServiceClient
	chat         cc.InternalAuthorizationServiceClient
	transport    *http.Transport
	certificates []*x509.Certificate
}

func privateAuthorityURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.RawPath != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || u.Opaque != "" {
		return control.ErrUnavailable
	}
	if u.Port() != "" {
		n, err := strconv.Atoi(u.Port())
		if err != nil || n < 1 || n > 65535 {
			return control.ErrUnavailable
		}
	}
	return nil
}

// Constructor не читает env и не подключает listener/main; TLS material operator-owned.
func NewPrivateAuthorityClient(cfg PrivateAuthorityConfig) (*PrivateAuthorityClient, error) {
	if privateAuthorityURL(cfg.IdentityBaseURL) != nil || privateAuthorityURL(cfg.ChatBaseURL) != nil || cfg.ServerCAFile == "" || cfg.TLSCertFile == "" || cfg.TLSKeyFile == "" {
		return nil, control.ErrUnavailable
	}
	pair, err := tls.LoadX509KeyPair(cfg.TLSCertFile, cfg.TLSKeyFile)
	if err != nil || len(pair.Certificate) == 0 {
		return nil, control.ErrUnavailable
	}
	leaf, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil || leaf.IsCA || len(leaf.URIs) != 1 || leaf.URIs[0].String() != "urn:aerochat:service:rtc-control" || time.Now().Before(leaf.NotBefore) || !time.Now().Before(leaf.NotAfter) {
		return nil, control.ErrUnavailable
	}
	usage := false
	for _, eku := range leaf.ExtKeyUsage {
		if eku == x509.ExtKeyUsageClientAuth {
			usage = true
		}
	}
	if !usage {
		return nil, control.ErrUnavailable
	}
	data, err := os.ReadFile(cfg.ServerCAFile)
	if err != nil {
		return nil, control.ErrUnavailable
	}
	roots := x509.NewCertPool()
	certs := []*x509.Certificate{leaf}
	count := 0
	for len(bytes.TrimSpace(data)) > 0 {
		data = bytes.TrimSpace(data)
		if !bytes.HasPrefix(data, []byte("-----BEGIN CERTIFICATE-----")) {
			return nil, control.ErrUnavailable
		}
		block, rest := pem.Decode(data)
		if block == nil || block.Type != "CERTIFICATE" {
			return nil, control.ErrUnavailable
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil || !cert.IsCA || cert.KeyUsage&x509.KeyUsageCertSign == 0 || time.Now().Before(cert.NotBefore) || !time.Now().Before(cert.NotAfter) {
			return nil, control.ErrUnavailable
		}
		roots.AddCert(cert)
		certs = append(certs, cert)
		count++
		data = rest
	}
	if count == 0 {
		return nil, control.ErrUnavailable
	}
	transport := &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: control.RequestBudget}).DialContext, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: roots, Certificates: []tls.Certificate{pair}}, TLSHandshakeTimeout: control.RequestBudget, ResponseHeaderTimeout: control.RequestBudget, IdleConnTimeout: 30 * time.Second, MaxConnsPerHost: 2, MaxIdleConnsPerHost: 2, MaxResponseHeaderBytes: 8192}
	httpClient := &http.Client{Transport: transport, Timeout: control.RequestBudget, CheckRedirect: func(*http.Request, []*http.Request) error { return control.ErrUnavailable }}
	return &PrivateAuthorityClient{identity: ic.NewInternalAuthorizationServiceClient(httpClient, cfg.IdentityBaseURL, connect.WithReadMaxBytes(4096), connect.WithSendMaxBytes(4096)), chat: cc.NewInternalAuthorizationServiceClient(httpClient, cfg.ChatBaseURL, connect.WithReadMaxBytes(4096), connect.WithSendMaxBytes(4096)), transport: transport, certificates: certs}, nil
}

func (c *PrivateAuthorityClient) Close() {
	if c != nil && c.transport != nil {
		c.transport.CloseIdleConnections()
	}
}
func (c *PrivateAuthorityClient) valid(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if c == nil || c.identity == nil || c.chat == nil {
		return control.ErrUnavailable
	}
	now := time.Now()
	for _, cert := range c.certificates {
		if now.Before(cert.NotBefore) || !now.Before(cert.NotAfter) {
			return control.ErrUnavailable
		}
	}
	return nil
}
func privateAuthorityError(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if connect.CodeOf(err) == connect.CodeUnauthenticated {
		return control.ErrUnauthenticated
	}
	if connect.CodeOf(err) == connect.CodeCanceled {
		return context.Canceled
	}
	if connect.CodeOf(err) == connect.CodeDeadlineExceeded {
		return context.DeadlineExceeded
	}
	return control.ErrUnavailable
}
func canonicalAuthorityID(raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil || id == uuid.Nil || raw != id.String() {
		return uuid.Nil, control.ErrUnavailable
	}
	return id, nil
}
func activeSubject(a *ipb.SessionAuthority) (control.OwnStatusSubject, error) {
	if a == nil {
		return control.OwnStatusSubject{}, control.ErrUnavailable
	}
	if a.Status == ipb.AuthorityStatus_AUTHORITY_STATUS_REVOKED || a.Status == ipb.AuthorityStatus_AUTHORITY_STATUS_NOT_FOUND {
		return control.OwnStatusSubject{}, control.ErrUnauthenticated
	}
	if a.Status != ipb.AuthorityStatus_AUTHORITY_STATUS_ACTIVE {
		return control.OwnStatusSubject{}, control.ErrUnavailable
	}
	u, e1 := canonicalAuthorityID(a.UserId)
	s, e2 := canonicalAuthorityID(a.SessionId)
	d, e3 := canonicalAuthorityID(a.DeviceId)
	out := control.OwnStatusSubject{UserID: u, SessionID: s, DeviceID: d, SessionRevision: a.SessionAuthorityRevision, DeviceRevision: a.DeviceAuthorityRevision}
	if e1 != nil || e2 != nil || e3 != nil || out.Validate() != nil {
		return control.OwnStatusSubject{}, control.ErrUnavailable
	}
	return out, nil
}
func (c *PrivateAuthorityClient) Resolve(ctx context.Context, bearer string) (control.OwnStatusSubject, error) {
	if err := c.valid(ctx); err != nil {
		return control.OwnStatusSubject{}, err
	}
	request := connect.NewRequest(&ipb.ResolveSessionBearerRequest{})
	request.Header().Set("Authorization", "Bearer "+bearer)
	response, err := c.identity.ResolveSessionBearer(ctx, request)
	if err != nil {
		return control.OwnStatusSubject{}, privateAuthorityError(ctx, err)
	}
	if response == nil || response.Msg == nil {
		return control.OwnStatusSubject{}, control.ErrUnavailable
	}
	return activeSubject(response.Msg.Authority)
}
func (c *PrivateAuthorityClient) CheckBound(ctx context.Context, subject control.OwnStatusSubject) (control.OwnStatusSubject, error) {
	if err := c.valid(ctx); err != nil {
		return control.OwnStatusSubject{}, err
	}
	if subject.Validate() != nil {
		return control.OwnStatusSubject{}, control.ErrUnauthenticated
	}
	response, err := c.identity.CheckBoundSession(ctx, connect.NewRequest(&ipb.CheckBoundSessionRequest{UserId: subject.UserID.String(), SessionId: subject.SessionID.String(), DeviceId: subject.DeviceID.String()}))
	if err != nil {
		return control.OwnStatusSubject{}, privateAuthorityError(ctx, err)
	}
	if response == nil || response.Msg == nil {
		return control.OwnStatusSubject{}, control.ErrUnavailable
	}
	out, err := activeSubject(response.Msg.Authority)
	if err != nil {
		return control.OwnStatusSubject{}, err
	}
	if out != subject {
		return control.OwnStatusSubject{}, control.ErrUnavailable
	}
	return out, nil
}
func (c *PrivateAuthorityClient) CheckGroup(ctx context.Context, group, user uuid.UUID) (control.GroupFacts, error) {
	if err := c.valid(ctx); err != nil {
		return control.GroupFacts{}, err
	}
	if group == uuid.Nil || user == uuid.Nil {
		return control.GroupFacts{}, control.ErrUnavailable
	}
	response, err := c.chat.CheckGroupSubject(ctx, connect.NewRequest(&cpb.CheckGroupSubjectRequest{GroupId: group.String(), UserId: user.String()}))
	if err != nil {
		return control.GroupFacts{}, privateAuthorityError(ctx, err)
	}
	if response == nil || response.Msg == nil || response.Msg.Authority == nil {
		return control.GroupFacts{}, control.ErrUnavailable
	}
	a := response.Msg.Authority
	if a.Status == cpb.GroupAuthorityStatus_GROUP_AUTHORITY_STATUS_NOT_FOUND {
		if a.GroupId != "" || a.UserId != "" || a.EligibilityEpoch != 0 || a.Role != cpb.GroupAuthorityRole_GROUP_AUTHORITY_ROLE_UNSPECIFIED {
			return control.GroupFacts{}, control.ErrUnavailable
		}
		return control.GroupFacts{Status: "not_found"}, nil
	}
	g, e1 := canonicalAuthorityID(a.GroupId)
	u, e2 := canonicalAuthorityID(a.UserId)
	if e1 != nil || e2 != nil || g != group || u != user {
		return control.GroupFacts{}, control.ErrUnavailable
	}
	out := control.GroupFacts{GroupID: g, UserID: u, Epoch: a.EligibilityEpoch}
	switch a.Status {
	case cpb.GroupAuthorityStatus_GROUP_AUTHORITY_STATUS_REMOVED:
		if a.Role != cpb.GroupAuthorityRole_GROUP_AUTHORITY_ROLE_UNSPECIFIED {
			return control.GroupFacts{}, control.ErrUnavailable
		}
		out.Status = "removed"
	case cpb.GroupAuthorityStatus_GROUP_AUTHORITY_STATUS_PRESENT:
		out.Status = "present"
		switch a.Role {
		case cpb.GroupAuthorityRole_GROUP_AUTHORITY_ROLE_OWNER:
			out.Role = "owner"
		case cpb.GroupAuthorityRole_GROUP_AUTHORITY_ROLE_ADMIN:
			out.Role = "admin"
		case cpb.GroupAuthorityRole_GROUP_AUTHORITY_ROLE_MEMBER:
			out.Role = "member"
		case cpb.GroupAuthorityRole_GROUP_AUTHORITY_ROLE_READER:
			out.Role = "reader"
		default:
			return control.GroupFacts{}, control.ErrUnavailable
		}
	default:
		return control.GroupFacts{}, control.ErrUnavailable
	}
	if out.Validate() != nil {
		return control.GroupFacts{}, control.ErrUnavailable
	}
	return out, nil
}
