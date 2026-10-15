//go:build integration

package minio

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
)

func postPolicyFixture(t *testing.T, ctx context.Context, upload *chat.PresignedObjectUpload, payload []byte, contentType string) int {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for key, value := range upload.FormFields {
		if key == "Content-Type" {
			value = contentType
		}
		if err := writer.WriteField(key, value); err != nil {
			t.Fatal("cannot write policy field")
		}
	}
	file, err := writer.CreateFormFile("file", "ciphertext.bin")
	if err != nil {
		t.Fatal("cannot create fixture file")
	}
	if _, err := file.Write(payload); err != nil {
		t.Fatal("cannot write fixture file")
	}
	if err := writer.Close(); err != nil {
		t.Fatal("cannot close fixture form")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, upload.URL, &body)
	if err != nil {
		t.Fatal("cannot construct policy request")
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	httpClient := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := httpClient.Do(request)
	if err != nil {
		t.Fatal("policy fixture transport failed")
	}
	if _, err := io.Copy(io.Discard, io.LimitReader(response.Body, 4096)); err != nil {
		t.Error("policy fixture response read failed")
	}
	if err := response.Body.Close(); err != nil {
		t.Error("policy fixture response close failed")
	}
	return response.StatusCode
}

func TestBoundedStagingAndConditionalPromotion(t *testing.T) {
	client := disposableStorageClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := client.EnsureBucket(ctx); err != nil {
		t.Fatal("cannot verify fixture staging lifecycle")
	}
	source, final := "staging/"+uuid.NewString(), "final/"+uuid.NewString()
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		for _, key := range []string{source, final} {
			if err := client.DeleteObject(cleanupCtx, key); err != nil {
				t.Error("fixture key cleanup failed")
			}
		}
	})
	upload, err := client.CreateUpload(ctx, source, "application/octet-stream", 1, time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal("cannot sign bounded fixture")
	}
	for _, fixture := range []struct {
		name  string
		bytes []byte
		mime  string
	}{
		{name: "oversize", bytes: []byte{1, 2}, mime: "application/octet-stream"},
		{name: "mime", bytes: []byte{1}, mime: "text/html"},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			status := postPolicyFixture(t, ctx, upload, fixture.bytes, fixture.mime)
			if status >= 200 && status < 300 {
				t.Fatalf("storage accepted invalid %s upload", fixture.name)
			}
			if _, err := client.StatObject(ctx, source); err == nil {
				t.Fatal("rejected upload created an object")
			}
		})
	}
	if status := postPolicyFixture(t, ctx, upload, []byte{1}, "application/octet-stream"); status != 204 {
		t.Fatalf("valid upload status=%d", status)
	}
	first, err := client.StatObject(ctx, source)
	if err != nil {
		t.Fatal("cannot stat initial staging")
	}
	if status := postPolicyFixture(t, ctx, upload, []byte{2}, "application/octet-stream"); status != 204 {
		t.Fatalf("staging replay status=%d", status)
	}
	if err := client.PromoteObject(ctx, source, final, first.ETag, "application/octet-stream"); err == nil {
		t.Fatal("stale ETag promotion succeeded")
	}
	if _, err := client.StatObject(ctx, final); err == nil {
		t.Fatal("stale promotion published final")
	}
	current, err := client.StatObject(ctx, source)
	if err != nil {
		t.Fatal("cannot stat changed staging")
	}
	if err := client.PromoteObject(ctx, source, final, current.ETag, "application/octet-stream"); err != nil {
		t.Fatal("matching ETag promotion failed")
	}
	if status := postPolicyFixture(t, ctx, upload, []byte{3}, "application/octet-stream"); status != 204 {
		t.Fatalf("post-complete replay status=%d", status)
	}
	download, err := client.CreateDownload(ctx, final, time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal("cannot sign final download")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, download.URL, nil)
	if err != nil {
		t.Fatal("cannot construct final download")
	}
	response, err := (&http.Client{Timeout: 5 * time.Second}).Do(request)
	if err != nil {
		t.Fatal("final download transport failed")
	}
	actual, readErr := io.ReadAll(io.LimitReader(response.Body, 2))
	closeErr := response.Body.Close()
	if readErr != nil || closeErr != nil || response.StatusCode != 200 || !bytes.Equal(actual, []byte{2}) {
		t.Fatal("staging replay changed final bytes")
	}
	if response.Header.Get("Content-Type") != "application/octet-stream" || response.Header.Get("Content-Disposition") != "attachment" {
		t.Fatal("unsafe final response headers")
	}
}
