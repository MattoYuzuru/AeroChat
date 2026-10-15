package notifications

import (
	"context"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"errors"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

func pushFixture(t *testing.T, endpoint string) (*WebPushClient, Subscription) {
	t.Helper()
	private, public, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return NewWebPushClient("mailto:test@example.com", public, private), Subscription{
		ID: "fixture", Endpoint: endpoint,
		P256DHKey:  base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()),
		AuthSecret: base64.RawURLEncoding.EncodeToString(make([]byte, 16)),
	}
}

func TestWebPushRejectsOwnedLocalEndpointBeforeNetwork(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()
	client, subscription := pushFixture(t, server.URL+"/owned-capability")
	invalid, err := client.SendJSON(context.Background(), []Subscription{subscription}, "fixture", map[string]string{"kind": "test"})
	if calls.Load() != 0 || len(invalid) != 1 || invalid[0] != subscription.ID || err == nil {
		t.Fatalf("expected rejected URL without network: calls=%d invalid=%d error=%v", calls.Load(), len(invalid), err)
	}
}

func ownedPushTLS(t *testing.T, handler http.Handler) (*httptest.Server, *x509.CertPool) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	certificate := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "owned push fixture"},
		DNSNames:  []string{"fcm.googleapis.com", "web.push.apple.com", "updates.push.services.mozilla.com"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, certificate, certificate, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(parsed)
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Fixture завершает чтение request до ответа: ранний close при отключённом
		// keep-alive иначе гоняется с клиентской записью и даёт broken pipe.
		// Отмена request допускает read error; её проверяет вызывающий сценарий.
		_, _ = io.Copy(io.Discard, r.Body)
		handler.ServeHTTP(w, r)
	}))
	server.TLS = &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}}
	server.StartTLS()
	t.Cleanup(server.Close)
	return server, roots
}

func fixtureHTTPClient(t *testing.T, server *httptest.Server, roots *x509.CertPool) *http.Client {
	t.Helper()
	dialer := &net.Dialer{Timeout: time.Second}
	client := newPushHTTPClient(func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("8.8.8.8")}, nil
	}, func(ctx context.Context, network, address string) (net.Conn, error) {
		if address != "8.8.8.8:443" {
			t.Error("transport did not dial checked numeric address")
			return nil, errors.New("invalid fixture dial")
		}
		// Проверенный адрес отображается только на собственный fixture listener; публичной сети здесь нет.
		return dialer.DialContext(ctx, network, server.Listener.Addr().String())
	})
	client.Transport.(*http.Transport).TLSClientConfig.RootCAs = roots
	return client
}

func TestWebPushProviderStatusAndOpaqueCapability(t *testing.T) {
	for _, status := range []int{201, 204, 404, 410, 302, 429, 500} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			var calls atomic.Int32
			server, roots := ownedPushTLS(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.URL.RequestURI() != "/opaque%2Fcap?key=a%2Fb+c" || r.Host != "fcm.googleapis.com" || r.TLS.ServerName != "fcm.googleapis.com" {
					t.Error("original capability/HTTPS authority was changed")
				}
				if r.Header.Get("Content-Encoding") != "aes128gcm" || r.Header.Get("Authorization") == "" {
					t.Error("standard Web Push SDK headers missing")
				}
				w.Header().Set("Location", "http://127.0.0.1/forbidden-redirect")
				w.WriteHeader(status)
			}))
			client, subscription := pushFixture(t, "https://fcm.googleapis.com/opaque%2Fcap?key=a%2Fb+c")
			client.httpClient = fixtureHTTPClient(t, server, roots)
			invalid, err := client.SendJSON(context.Background(), []Subscription{subscription}, "fixture", map[string]string{"kind": "test"})
			wantInvalid := status == 404 || status == 410
			wantError := status >= 300 && !wantInvalid
			if calls.Load() != 1 || (len(invalid) == 1) != wantInvalid || (err != nil) != wantError {
				t.Fatalf("unexpected provider semantics: status=%d calls=%d invalid=%d error=%v", status, calls.Load(), len(invalid), err)
			}
			if err != nil && (strings.Contains(err.Error(), "cap") || strings.Contains(err.Error(), "key=")) {
				t.Fatal("error exposed capability")
			}
		})
	}
}

func TestWebPushRejectsMixedDNSWithoutRemovingSubscription(t *testing.T) {
	client, subscription := pushFixture(t, "https://fcm.googleapis.com/secret-capability")
	var dials atomic.Int32
	client.httpClient = newPushHTTPClient(func(context.Context, string, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("8.8.8.8"), netip.MustParseAddr("127.0.0.1")}, nil
	}, func(context.Context, string, string) (net.Conn, error) {
		dials.Add(1)
		return nil, errors.New("unexpected")
	})
	invalid, err := client.SendJSON(context.Background(), []Subscription{subscription}, "fixture", nil)
	if err == nil || len(invalid) != 0 || dials.Load() != 0 || strings.Contains(err.Error(), "secret-capability") || strings.Contains(err.Error(), "fcm") {
		t.Fatal("DNS failure must deny send, retain subscription and redact error")
	}
}

func TestWebPushTLSVerificationAndConcurrentAuthority(t *testing.T) {
	var calls atomic.Int32
	server, roots := ownedPushTLS(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Host != r.TLS.ServerName {
			t.Error("TLS authority drift")
		}
		w.WriteHeader(http.StatusCreated)
	}))
	client, subscription := pushFixture(t, "https://fcm.googleapis.com/cap")
	client.httpClient = fixtureHTTPClient(t, server, roots)
	var wait sync.WaitGroup
	for _, endpoint := range []string{"https://fcm.googleapis.com/cap", "https://web.push.apple.com/cap"} {
		wait.Add(1)
		go func(endpoint string) {
			defer wait.Done()
			copy := subscription
			copy.Endpoint = endpoint
			if _, err := client.SendJSON(context.Background(), []Subscription{copy}, "fixture", nil); err != nil {
				t.Error(err)
			}
		}(endpoint)
	}
	wait.Wait()
	if calls.Load() != 2 || client.httpClient.Transport.(*http.Transport).TLSClientConfig.ServerName != "" {
		t.Fatal("concurrent request mutated shared TLS authority")
	}
	subscription.Endpoint = "https://other.push.apple.com/cap"
	invalid, err := client.SendJSON(context.Background(), []Subscription{subscription}, "fixture", nil)
	if err == nil || len(invalid) != 0 || calls.Load() != 2 {
		t.Fatal("invalid certificate must deny send without removing subscription")
	}
}

func TestWebPushDoesNotUseEnvironmentProxy(t *testing.T) {
	var proxyCalls atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { proxyCalls.Add(1); w.WriteHeader(500) }))
	defer proxy.Close()
	t.Setenv("HTTPS_PROXY", proxy.URL)
	t.Setenv("HTTP_PROXY", proxy.URL)
	t.Setenv("ALL_PROXY", proxy.URL)
	server, roots := ownedPushTLS(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(201) }))
	client, subscription := pushFixture(t, "https://fcm.googleapis.com/cap")
	client.httpClient = fixtureHTTPClient(t, server, roots)
	if _, err := client.SendJSON(context.Background(), []Subscription{subscription}, "fixture", nil); err != nil || proxyCalls.Load() != 0 {
		t.Fatal("push transport must ignore proxy environment")
	}
}

func TestWebPushRequestAndBatchCancellation(t *testing.T) {
	for _, batch := range []bool{false, true} {
		t.Run(map[bool]string{false: "request", true: "batch"}[batch], func(t *testing.T) {
			var calls atomic.Int32
			server, roots := ownedPushTLS(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				attempt := calls.Add(1)
				_, _ = io.Copy(io.Discard, io.LimitReader(r.Body, 16384))
				_ = r.Body.Close()
				if batch && attempt == 1 {
					w.WriteHeader(201)
					return
				}
				<-r.Context().Done()
			}))
			client, subscription := pushFixture(t, "https://fcm.googleapis.com/secret-cap")
			client.httpClient = fixtureHTTPClient(t, server, roots)
			subscriptions := []Subscription{subscription}
			if batch {
				client.batchTimeout = 300 * time.Millisecond
				subscriptions = append(subscriptions, subscription, subscription)
			} else {
				client.httpClient.Timeout = 20 * time.Millisecond
			}
			started := time.Now()
			invalid, err := client.SendJSON(context.Background(), subscriptions, "fixture", nil)
			if err == nil || len(invalid) != 0 || time.Since(started) > time.Second || strings.Contains(err.Error(), "secret-cap") {
				t.Fatal("deadline must return bounded sanitized failure without removing subscription")
			}
			if batch && calls.Load() != 2 {
				t.Fatalf("batch should stop after partial attempt: %d", calls.Load())
			}
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			before := calls.Load()
			if _, err := client.SendJSON(ctx, []Subscription{subscription}, "fixture", nil); err == nil || calls.Load() != before {
				t.Fatal("cancelled batch sent bytes")
			}
		})
	}
}
