package notifications

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"strings"
	"testing"
	"time"
)

func TestNormalizeWebPushEndpoint(t *testing.T) {
	t.Parallel()
	for _, endpoint := range []string{
		"https://fcm.googleapis.com/fcm/send/opaque%2Fpath?cap=a%2Fb+c",
		"https://updates.push.services.mozilla.com/wpush/v2/capability",
		"https://web.push.apple.com/Q/capability", "https://eu.web.push.apple.com/Q/capability",
	} {
		got, err := NormalizeWebPushEndpoint(endpoint)
		if err != nil || got != endpoint {
			t.Fatalf("valid capability was changed or denied: %v", err)
		}
	}
	got, err := NormalizeWebPushEndpoint(" https://FCM.GOOGLEAPIS.COM:443/fcm/send/CaP?Q=x%2Fz ")
	if err != nil || got != "https://fcm.googleapis.com/fcm/send/CaP?Q=x%2Fz" {
		t.Fatal("canonical authority should preserve opaque path/query")
	}
	for _, endpoint := range []string{
		"", "http://fcm.googleapis.com/cap", "https://127.0.0.1/cap", "https://[::1]/cap",
		"https://fcm.googleapis.com:8443/cap", "https://fcm.googleapis.com:/cap",
		"https://user:password@fcm.googleapis.com/cap", "https://fcm.googleapis.com/cap#",
		"https://fcm.googleapis.com/cap#fragment", "https://fcm.googleapis.com./cap",
		"https://fcm.googleapis.com.evil.example/cap", "https://evil-fcm.googleapis.com/cap",
		"https://push.apple.com/cap", "https://evilpush.apple.com/cap", "https://.push.apple.com/cap",
		"https://-bad.push.apple.com/cap", "https://a_.push.apple.com/cap", "https://é.push.apple.com/cap",
		"https://fcm%2egoogleapis.com/cap", "https:opaque", "https://arbitrary.example/cap",
		"https://" + strings.Repeat("a", 64) + ".push.apple.com/cap",
		"https://fcm.googleapis.com/" + strings.Repeat("a", 4096),
	} {
		if _, err := NormalizeWebPushEndpoint(endpoint); !errors.Is(err, ErrWebPushEndpoint) {
			t.Fatal("untrusted capability was accepted")
		}
	}
}

func TestPushAddressPolicy(t *testing.T) {
	t.Parallel()
	for _, value := range []string{"8.8.8.8", "1.1.1.1", "::ffff:8.8.8.8", "2001:4860:4860::8888", "2606:4700:4700::1111"} {
		if !allowedPushAddress(netip.MustParseAddr(value)) {
			t.Fatalf("ordinary global fixture address denied: %s", value)
		}
	}
	for _, value := range []string{
		"0.1.2.3", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1",
		"192.0.0.9", "192.0.2.1", "192.31.196.1", "192.52.193.1", "192.88.99.2", "192.168.1.1",
		"192.175.48.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.1.2.3",
		"255.255.255.255", "::", "::1", "::ffff:127.0.0.1", "::ffff:192.168.1.1", "::8.8.8.8",
		"64:ff9b::0808:0808", "64:ff9b:1::1", "100::1", "100:0:0:1::1", "2001::1",
		"2001:1::1", "2001:2::1", "2001:20::1", "2001:db8::1", "2002:7f00:1::1",
		"2620:4f:8000::1", "3fff::1", "5f00::1", "fc00::1", "fe80::1", "fec0::1", "ff02::1",
		"2001:4860:4860::8888%en0",
	} {
		if allowedPushAddress(netip.MustParseAddr(value)) {
			t.Fatalf("special/private fixture address accepted: %s", value)
		}
	}
}

func TestPushDialValidatesEntireAnswerBeforeNumericDial(t *testing.T) {
	t.Parallel()
	for _, addresses := range [][]netip.Addr{
		nil,
		{netip.MustParseAddr("8.8.8.8"), netip.MustParseAddr("127.0.0.1")},
		{netip.MustParseAddr("::ffff:10.0.0.1")},
		make([]netip.Addr, pushMaxDNSAddresses+1),
	} {
		dials := 0
		call := validatedPushDial(func(context.Context, string, string) ([]netip.Addr, error) { return addresses, nil },
			func(context.Context, string, string) (net.Conn, error) {
				dials++
				return nil, errors.New("unexpected dial")
			})
		if _, err := call(context.Background(), "tcp", "fcm.googleapis.com:443"); err == nil || dials != 0 {
			t.Fatal("untrusted answer must be rejected before every dial")
		}
	}
	lookups := 0
	left, right := net.Pipe()
	defer func() { _ = left.Close() }()
	defer func() { _ = right.Close() }()
	call := validatedPushDial(func(_ context.Context, network, host string) ([]netip.Addr, error) {
		lookups++
		if network != "ip" || host != "fcm.googleapis.com" {
			t.Fatal("unexpected resolver authority")
		}
		if lookups > 1 {
			return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
		}
		return []netip.Addr{netip.MustParseAddr("::ffff:8.8.8.8")}, nil
	}, func(_ context.Context, network, address string) (net.Conn, error) {
		if network != "tcp" || address != "8.8.8.8:443" {
			t.Fatal("dial did not pin checked numeric IP")
		}
		return left, nil
	})
	if connection, err := call(context.Background(), "tcp", "fcm.googleapis.com:443"); err != nil || connection != left || lookups != 1 {
		t.Fatal("resolver must not run again after address validation")
	}
}

func TestPushDNSHonorsCallerDeadline(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	call := validatedPushDial(func(ctx context.Context, _, _ string) ([]netip.Addr, error) { <-ctx.Done(); return nil, ctx.Err() },
		func(context.Context, string, string) (net.Conn, error) {
			t.Fatal("dial after DNS failure")
			return nil, nil
		})
	if _, err := call(ctx, "tcp", "fcm.googleapis.com:443"); err == nil {
		t.Fatal("deadline must deny send")
	}
}
