package minio

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestPresignUsesInternalBucketRegionWithoutPublicRequests(t *testing.T) {
	for _, region := range []string{"eu-central-1", ""} {
		t.Run("region="+region, func(t *testing.T) {
			var internalRequests, publicRequests atomic.Int32
			internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				internalRequests.Add(1)
				if r.Method != http.MethodGet || r.URL.Path != "/attachments/" || !r.URL.Query().Has("location") {
					t.Errorf("unexpected internal request: %s %s", r.Method, r.URL.Path)
				}
				w.Header().Set("Content-Type", "application/xml")
				fmt.Fprintf(w, "<LocationConstraint>%s</LocationConstraint>", region)
			}))
			defer internal.Close()
			public := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				publicRequests.Add(1)
				fmt.Fprint(w, "<LocationConstraint>us-west-2</LocationConstraint>")
			}))
			defer public.Close()
			client, err := NewClient(internal.URL, false, public.URL, false, "fixture-access", "fixture-secret", "attachments")
			if err != nil {
				t.Fatal(err)
			}
			expires := time.Now().Add(time.Minute)
			upload, err := client.CreateUpload(context.Background(), "fixture.bin", "application/octet-stream", expires)
			if err != nil {
				t.Fatal(err)
			}
			download, err := client.CreateDownload(context.Background(), "fixture.bin", expires)
			if err != nil {
				t.Fatal(err)
			}
			if region == "" {
				region = "us-east-1"
			}
			for _, raw := range []string{upload.URL, download.URL} {
				parsed, err := url.Parse(raw)
				if err != nil {
					t.Fatal(err)
				}
				if !strings.HasPrefix(raw, public.URL+"/attachments/fixture.bin?") {
					t.Fatalf("URL does not use public endpoint")
				}
				if credential := parsed.Query().Get("X-Amz-Credential"); !strings.Contains(credential, "/"+region+"/s3/aws4_request") {
					t.Errorf("unexpected region in credential scope: %s", credential)
				}
			}
			if upload.HTTPMethod != http.MethodPut || upload.Headers["Content-Type"] != "application/octet-stream" {
				t.Errorf("upload contract: method=%s headers=%v", upload.HTTPMethod, upload.Headers)
			}
			if got := publicRequests.Load(); got != 0 {
				t.Errorf("public endpoint received %d signing requests, want 0", got)
			}
			if got := internalRequests.Load(); got != 1 {
				t.Errorf("internal region requests=%d, want 1", got)
			}
		})
	}
}

func TestPresignRetriesInternalRegionAfterFailure(t *testing.T) {
	var requests atomic.Int32
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if requests.Add(1) == 1 {
			w.WriteHeader(http.StatusNotFound)
			fmt.Fprint(w, "<Error><Code>NoSuchBucket</Code><Message>fixture bucket missing</Message></Error>")
			return
		}
		fmt.Fprint(w, "<LocationConstraint>eu-west-1</LocationConstraint>")
	}))
	defer internal.Close()
	client, err := NewClient(internal.URL, false, "https://media.example.invalid", true, "fixture-access", "fixture-secret", "attachments")
	if err != nil {
		t.Fatal(err)
	}
	if upload, err := client.CreateUpload(context.Background(), "fixture", "", time.Now().Add(time.Minute)); err == nil || upload != nil {
		t.Fatal("missing internal bucket must fail before issuing a URL")
	}
	if _, err := client.CreateDownload(context.Background(), "fixture", time.Now().Add(time.Minute)); err != nil {
		t.Fatalf("region resolution must recover: %v", err)
	}
}

func TestPresignConcurrentRegionDiscovery(t *testing.T) {
	var requests atomic.Int32
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		fmt.Fprint(w, "<LocationConstraint>eu-west-1</LocationConstraint>")
	}))
	defer internal.Close()
	client, err := NewClient(internal.URL, false, "https://media.example.invalid", true, "fixture-access", "fixture-secret", "attachments")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := client.CreateDownload(context.Background(), "fixture", time.Now().Add(time.Minute)); err != nil {
				t.Errorf("sign download: %v", err)
			}
		}()
	}
	wg.Wait()
	if got := requests.Load(); got != 1 {
		t.Errorf("region discovery requests=%d, want 1", got)
	}
}

func TestPresignCancelledAndExpired(t *testing.T) {
	client, err := NewClient("127.0.0.1:1", false, "media.example.invalid", true, "fixture-access", "fixture-secret", "attachments")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := client.CreateDownload(ctx, "fixture", time.Now().Add(time.Minute)); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled signing: %v", err)
	}
	if _, err := client.CreateUpload(context.Background(), "fixture", "", time.Now().Add(-time.Second)); err == nil {
		t.Fatal("expired upload must fail before region discovery")
	}
}
