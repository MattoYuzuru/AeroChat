package observability

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNewBaseMuxReady(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := NewBaseMux(ServiceMeta{Name: "test-service", Version: "dev"}, logger, nil)

	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("ожидался статус %d, получен %d", http.StatusOK, recorder.Code)
	}
}

func TestNewBaseMuxNotReady(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := NewBaseMux(ServiceMeta{Name: "test-service", Version: "dev"}, logger, func(context.Context) error {
		return errors.New("dependency unavailable")
	})

	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("ожидался статус %d, получен %d", http.StatusServiceUnavailable, recorder.Code)
	}
}

func TestWrapHTTPInstrumentationRecoversFromPanic(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := WrapHTTPInstrumentation(logger, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}))

	request := httptest.NewRequest(http.MethodPost, "/rpc", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("ожидался статус %d, получен %d", http.StatusInternalServerError, recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "\"code\":\"internal\"") {
		t.Fatalf("ожидалось JSON-описание internal ошибки, получено %q", recorder.Body.String())
	}
}
