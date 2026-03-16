package edgehttp

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWrapCORSAcceptsConfiguredOrigin(t *testing.T) {
	handler := WrapCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}), []string{"http://localhost:5173"})

	request := httptest.NewRequest(http.MethodOptions, "/aerochat.identity.v1.IdentityService/GetCurrentProfile", nil)
	request.Header.Set("Origin", "http://localhost:5173")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	request.Header.Set("Access-Control-Request-Headers", "Authorization,Content-Type")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("ожидался статус %d, получен %d", http.StatusNoContent, recorder.Code)
	}
	if recorder.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Fatalf("ожидался allow origin для localhost:5173, получен %q", recorder.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestWrapCORSRejectsUnknownOriginPreflight(t *testing.T) {
	handler := WrapCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}), []string{"http://localhost:5173"})

	request := httptest.NewRequest(http.MethodOptions, "/aerochat.chat.v1.ChatService/ListDirectChats", nil)
	request.Header.Set("Origin", "http://malicious.local")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("ожидался статус %d, получен %d", http.StatusForbidden, recorder.Code)
	}
}
