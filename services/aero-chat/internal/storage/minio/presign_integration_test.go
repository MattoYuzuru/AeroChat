//go:build integration

package minio

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestPresignUploadDownloadOnDisposableStorage(t *testing.T) {
	profilePath := os.Getenv("AERO_MEDIA_TEST_ENV_FILE")
	if profilePath == "" {
		t.Fatal("integration requires AERO_MEDIA_TEST_ENV_FILE for owned localhost storage")
	}
	data, err := os.ReadFile(profilePath)
	if err != nil {
		t.Fatal("cannot read media fixture profile")
	}
	profile := make(map[string]string)
	for _, line := range strings.Split(string(data), "\n") {
		key, value, ok := strings.Cut(line, "=")
		if ok && strings.HasPrefix(key, "AERO_MEDIA_S3_") {
			profile[key] = strings.TrimSpace(value)
		}
	}
	for _, key := range []string{"INTERNAL_ENDPOINT", "PRESIGN_ENDPOINT", "ACCESS_KEY", "SECRET_KEY", "BUCKET"} {
		if profile["AERO_MEDIA_S3_"+key] == "" {
			t.Fatalf("fixture profile missing AERO_MEDIA_S3_%s", key)
		}
	}
	internal, public := profile["AERO_MEDIA_S3_INTERNAL_ENDPOINT"], profile["AERO_MEDIA_S3_PRESIGN_ENDPOINT"]
	for _, endpoint := range []string{internal, public} {
		host, _, resolveErr := resolveEndpoint(endpoint, false)
		if resolveErr != nil {
			t.Fatal("invalid fixture endpoint")
		}
		parsed, parseErr := url.Parse("http://" + host)
		if parseErr != nil {
			t.Fatal("invalid fixture endpoint host")
		}
		ip := net.ParseIP(parsed.Hostname())
		if parsed.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback()) {
			t.Fatal("fixture endpoint must be localhost or a loopback IP")
		}
	}
	if internal == public {
		t.Fatal("fixture must use distinct internal and public endpoint names")
	}
	client, err := NewClient(internal, profile["AERO_MEDIA_S3_INTERNAL_SECURE"] == "true", public,
		profile["AERO_MEDIA_S3_PRESIGN_SECURE"] == "true", profile["AERO_MEDIA_S3_ACCESS_KEY"],
		profile["AERO_MEDIA_S3_SECRET_KEY"], profile["AERO_MEDIA_S3_BUCKET"])
	if err != nil {
		t.Fatal("cannot create fixture storage client")
	}
	key := "presign-fixture/" + uuid.NewString()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := client.DeleteObject(ctx, key); err != nil {
			t.Error("fixture object cleanup failed")
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	upload, err := client.CreateUpload(ctx, key, "application/octet-stream", time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal("upload signing failed against internal endpoint")
	}
	payload := []byte{0x91, 0x73, 0x08, 0xFE, 0x11, 0xC4, 0x21, 0xA9}
	request, err := http.NewRequestWithContext(ctx, upload.HTTPMethod, upload.URL, bytes.NewReader(payload))
	if err != nil {
		t.Fatal("cannot construct fixture upload")
	}
	for name, value := range upload.Headers {
		request.Header.Set(name, value)
	}
	httpClient := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	response, err := httpClient.Do(request)
	if err != nil {
		t.Fatal("presigned upload request failed")
	}
	_, copyErr := io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	closeErr := response.Body.Close()
	if response.StatusCode != http.StatusOK || copyErr != nil || closeErr != nil {
		t.Fatalf("upload status=%d or body read failed", response.StatusCode)
	}
	info, err := client.StatObject(ctx, key)
	if err != nil || info.Size != int64(len(payload)) || info.ContentType != "application/octet-stream" {
		t.Fatal("stored object metadata differs from upload")
	}
	download, err := client.CreateDownload(ctx, key, time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal("download signing failed against internal endpoint")
	}
	request, err = http.NewRequestWithContext(ctx, http.MethodGet, download.URL, nil)
	if err != nil {
		t.Fatal("cannot construct fixture download")
	}
	response, err = httpClient.Do(request)
	if err != nil {
		t.Fatal("presigned download request failed")
	}
	actual, readErr := io.ReadAll(io.LimitReader(response.Body, int64(len(payload)+1)))
	closeErr = response.Body.Close()
	if response.StatusCode != http.StatusOK || readErr != nil || closeErr != nil || !bytes.Equal(actual, payload) {
		t.Fatal("download did not return the exact uploaded bytes")
	}
}
