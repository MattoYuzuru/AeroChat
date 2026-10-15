package notifications

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"time"
)

const (
	pushDialTimeout     = 2 * time.Second
	pushRequestTimeout  = 5 * time.Second
	pushBatchTimeout    = 10 * time.Second
	pushMaxDNSAddresses = 16
)

var errPushTransport = errors.New("web push transport rejected or unavailable")

type pushLookup func(context.Context, string, string) ([]netip.Addr, error)
type pushDial func(context.Context, string, string) (net.Conn, error)

func newPushHTTPClient(lookup pushLookup, dial pushDial) *http.Client {
	transport := &http.Transport{
		Proxy:                  nil,
		DialContext:            validatedPushDial(lookup, dial),
		TLSClientConfig:        &tls.Config{MinVersion: tls.VersionTLS12},
		TLSHandshakeTimeout:    pushDialTimeout,
		ResponseHeaderTimeout:  pushDialTimeout,
		DisableKeepAlives:      true,
		ForceAttemptHTTP2:      false,
		MaxResponseHeaderBytes: 16 * 1024,
	}
	return &http.Client{
		Transport:     transport,
		Timeout:       pushRequestTimeout,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}
}

func validatedPushDial(lookup pushLookup, dial pushDial) pushDial {
	return func(ctx context.Context, network, authority string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(authority)
		if err != nil || network != "tcp" || port != "443" || !allowedPushHostname(host) {
			return nil, errPushTransport
		}
		ctx, cancel := context.WithTimeout(ctx, pushDialTimeout)
		defer cancel()
		addresses, err := lookup(ctx, "ip", host)
		if err != nil || len(addresses) == 0 || len(addresses) > pushMaxDNSAddresses {
			return nil, errPushTransport
		}
		for _, address := range addresses {
			if !allowedPushAddress(address) {
				return nil, errPushTransport
			}
		}
		for _, address := range addresses {
			connection, err := dial(ctx, "tcp", net.JoinHostPort(address.Unmap().String(), port))
			if err == nil {
				return connection, nil
			}
			if ctx.Err() != nil {
				break
			}
		}
		return nil, errPushTransport
	}
}
