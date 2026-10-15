package admission

import (
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"net/url"
	"testing"
	"time"
)

func TestRegistrationFingerprintUsesExactVerifiedLeafAndExplicitUsage(t *testing.T) {
	uri, _ := url.Parse(CallerURI)
	leaf := &x509.Certificate{Raw: []byte("owned-unit-certificate"), NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Minute), URIs: []*url.URL{uri}, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}
	state := tls.ConnectionState{Version: tls.VersionTLS13, PeerCertificates: []*x509.Certificate{leaf}, VerifiedChains: [][]*x509.Certificate{{leaf}}}
	actual, err := VerifiedFingerprint(state)
	if err != nil || actual != sha256.Sum256(leaf.Raw) {
		t.Fatal("fingerprint not verified DER")
	}
	state.VerifiedChains = nil
	if VerifyCaller(state) == nil {
		t.Fatal("unverified leaf accepted")
	}
	state.VerifiedChains = [][]*x509.Certificate{{leaf}}
	leaf.ExtKeyUsage = nil
	if VerifyCaller(state) == nil {
		t.Fatal("implicit any usage accepted")
	}
	leaf.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}
	leaf.URIs = append(leaf.URIs, uri)
	if VerifyCaller(state) == nil {
		t.Fatal("ambiguous identity accepted")
	}
}
