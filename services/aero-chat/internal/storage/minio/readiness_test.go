package minio

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestReadinessChecksBucketAndRecoversWithoutRecreatingClient(t *testing.T) {
	var status atomic.Int32
	status.Store(http.StatusOK)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Has("location") {
			w.Header().Set("Content-Type", "application/xml")
			_, _ = fmt.Fprint(w, "<LocationConstraint>us-east-1</LocationConstraint>")
			return
		}
		if r.Method != http.MethodHead || r.URL.Path != "/attachments/" {
			t.Errorf("readiness must only inspect bucket metadata: %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(int(status.Load()))
	}))
	defer server.Close()
	client, err := NewClient(server.URL, false, "http://127.0.0.1:1", false, "fixture-access", "fixture-secret", "attachments")
	if err != nil {
		t.Fatal(err)
	}
	for _, code := range []int{http.StatusOK, http.StatusNotFound, http.StatusForbidden, http.StatusOK} {
		status.Store(int32(code))
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		err := client.ReadinessCheck(ctx)
		cancel()
		if (err == nil) != (code == http.StatusOK) {
			t.Fatalf("status=%d: unexpected readiness result: %v", code, err)
		}
	}
}

func TestReadinessTimeoutAndErrorsDoNotExposeStorageResponse(t *testing.T) {
	const sensitiveMarker = "fixture-sensitive-upstream-error"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(http.StatusForbidden)
		_, _ = fmt.Fprintf(w, "<Error><Code>AccessDenied</Code><Message>%s</Message></Error>", sensitiveMarker)
	}))
	defer server.Close()
	client, err := NewClient(server.URL, false, "http://127.0.0.1:1", false, "fixture-access", "fixture-secret", "attachments")
	if err != nil {
		t.Fatal(err)
	}
	err = client.ReadinessCheck(context.Background())
	if err == nil || strings.Contains(err.Error(), sensitiveMarker) || strings.Contains(err.Error(), server.URL) {
		t.Fatalf("expected generic readiness error, got %v", err)
	}
	blocked := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer blocked.Close()
	blockedClient, err := NewClient(blocked.URL, false, "http://127.0.0.1:1", false, "fixture-access", "fixture-secret", "attachments")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	started := time.Now()
	if blockedClient.ReadinessCheck(ctx) == nil {
		t.Fatal("timed out storage must not be ready")
	}
	if time.Since(started) > time.Second {
		t.Fatal("readiness exceeded caller deadline budget")
	}
}
