package rtcrevocation

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"

	"connectrpc.com/connect"
	rtcpb "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/revocation/v1"
	rtcconnect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/revocation/v1/rtcrevocationv1connect"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/delivery"
	"github.com/google/uuid"
)

type Config struct {
	Enabled                                        bool
	BaseURL, ServerCAFile, TLSCertFile, TLSKeyFile string
}

func (c Config) Validate() error {
	if !c.Enabled {
		return nil
	}
	u, err := url.Parse(c.BaseURL)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.RawPath != "" || u.Fragment != "" || u.Opaque != "" || u.Path != "" && u.Path != "/" || c.ServerCAFile == "" || c.TLSCertFile == "" || c.TLSKeyFile == "" {
		return errors.New("Chat delivery requires private HTTPS authority and TLS material")
	}
	if u.Port() != "" {
		port, err := strconv.Atoi(u.Port())
		if err != nil || port < 1 || port > 65535 {
			return errors.New("Chat delivery HTTPS port invalid")
		}
	}
	return nil
}

type Client struct {
	client    rtcconnect.SourceRevocationServiceClient
	transport *http.Transport
}

func NewClient(cfg Config) (*Client, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	if !cfg.Enabled {
		return nil, nil
	}
	pair, err := tls.LoadX509KeyPair(cfg.TLSCertFile, cfg.TLSKeyFile)
	if err != nil {
		return nil, errors.New("Chat delivery client TLS material invalid")
	}
	leaf, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil || leaf.IsCA || time.Now().Before(leaf.NotBefore) || !time.Now().Before(leaf.NotAfter) || len(leaf.URIs) != 1 || leaf.URIs[0].String() != "urn:aerochat:service:chat" {
		return nil, errors.New("Chat delivery requires sole Chat client identity")
	}
	usage := false
	for _, u := range leaf.ExtKeyUsage {
		if u == x509.ExtKeyUsageClientAuth {
			usage = true
		}
	}
	if !usage {
		return nil, errors.New("Chat delivery requires client usage")
	}
	data, err := os.ReadFile(cfg.ServerCAFile)
	if err != nil {
		return nil, errors.New("Chat delivery server CA unavailable")
	}
	roots := x509.NewCertPool()
	count := 0
	for len(bytes.TrimSpace(data)) > 0 {
		block, rest := pem.Decode(data)
		if block == nil || block.Type != "CERTIFICATE" {
			return nil, errors.New("Chat delivery server CA invalid")
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil || !cert.IsCA || cert.KeyUsage&x509.KeyUsageCertSign == 0 || time.Now().Before(cert.NotBefore) || !time.Now().Before(cert.NotAfter) {
			return nil, errors.New("Chat delivery server CA invalid")
		}
		roots.AddCert(cert)
		count++
		data = rest
	}
	if count == 0 {
		return nil, errors.New("Chat delivery server CA required")
	}
	transport := &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: delivery.AttemptBudget}).DialContext, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: roots, Certificates: []tls.Certificate{pair}}, TLSHandshakeTimeout: delivery.AttemptBudget, ResponseHeaderTimeout: delivery.AttemptBudget, IdleConnTimeout: 30 * time.Second, MaxConnsPerHost: 1, MaxIdleConnsPerHost: 1, MaxResponseHeaderBytes: 8192}
	httpClient := &http.Client{Transport: transport, Timeout: delivery.AttemptBudget, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("Chat delivery redirect denied") }}
	return &Client{client: rtcconnect.NewSourceRevocationServiceClient(httpClient, cfg.BaseURL, connect.WithReadMaxBytes(4096), connect.WithSendMaxBytes(4096)), transport: transport}, nil
}
func (c *Client) Close() { c.transport.CloseIdleConnections() }
func (c *Client) Apply(ctx context.Context, e delivery.Event) (delivery.Receipt, error) {
	if !e.Validate() {
		return delivery.Receipt{}, delivery.ErrConflict
	}
	response, err := c.client.ApplyChatEvent(ctx, connect.NewRequest(&rtcpb.ApplyChatEventRequest{EventId: e.ID.String(), GroupId: e.GroupID.String(), UserId: e.UserID.String(), EligibilityEpoch: e.Epoch}))
	if err != nil {
		return delivery.Receipt{}, rpcError(ctx, err, false)
	}
	return receipt(response.Msg.GetReceipt()), nil
}
func (c *Client) Lookup(ctx context.Context, id uuid.UUID) (delivery.Receipt, error) {
	response, err := c.client.GetChatEventReceipt(ctx, connect.NewRequest(&rtcpb.GetChatEventReceiptRequest{EventId: id.String()}))
	if err != nil {
		return delivery.Receipt{}, rpcError(ctx, err, true)
	}
	return receipt(response.Msg.GetReceipt()), nil
}
func rpcError(ctx context.Context, err error, lookup bool) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	switch connect.CodeOf(err) {
	case connect.CodeAlreadyExists:
		return delivery.ErrConflict
	case connect.CodeNotFound:
		if lookup {
			return delivery.ErrNotFound
		}
	}
	return delivery.ErrUnavailable
}
func receipt(r *rtcpb.SourceEventReceipt) delivery.Receipt {
	if r == nil || r.GetSourceReceipt() != rtcpb.SourceReceiptStatus_SOURCE_RECEIPT_STATUS_DURABLY_APPLIED {
		return delivery.Receipt{}
	}
	event, e1 := uuid.Parse(r.GetEventId())
	operation, e2 := uuid.Parse(r.GetOperationId())
	if e1 != nil || e2 != nil {
		return delivery.Receipt{}
	}
	effect := ""
	switch r.GetRegistryMediaEffect() {
	case rtcpb.RegistryMediaEffect_REGISTRY_MEDIA_EFFECT_NO_MATCHING_REGISTRY_GRANTS:
		effect = "no_matching_registry_grants"
	case rtcpb.RegistryMediaEffect_REGISTRY_MEDIA_EFFECT_MEDIA_PENDING:
		effect = "media_pending"
	}
	return delivery.Receipt{EventID: event, OperationID: operation, Effect: effect, Count: int64(r.GetAffectedRegistryGrants())}
}
