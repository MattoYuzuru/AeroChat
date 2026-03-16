package edgehttp

import (
	"net/http"
	"strings"
)

var defaultAllowMethods = []string{
	http.MethodGet,
	http.MethodPost,
	http.MethodOptions,
}

func WrapCORS(next http.Handler, allowedOrigins []string) http.Handler {
	if len(allowedOrigins) == 0 {
		return next
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			next.ServeHTTP(w, r)
			return
		}

		allowOrigin, ok := resolveAllowedOrigin(origin, allowedOrigins)
		if !ok {
			if isPreflight(r) {
				http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
			return
		}

		headers := w.Header()
		headers.Add("Vary", "Origin")
		headers.Set("Access-Control-Allow-Origin", allowOrigin)

		if isPreflight(r) {
			headers.Add("Vary", "Access-Control-Request-Method")
			headers.Add("Vary", "Access-Control-Request-Headers")
			headers.Set("Access-Control-Allow-Methods", strings.Join(defaultAllowMethods, ", "))

			requestHeaders := r.Header.Get("Access-Control-Request-Headers")
			if requestHeaders == "" {
				requestHeaders = "Authorization, Content-Type, Connect-Protocol-Version, Connect-Timeout-Ms, X-User-Agent"
			}
			headers.Set("Access-Control-Allow-Headers", requestHeaders)
			headers.Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func isPreflight(r *http.Request) bool {
	return r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != ""
}

func resolveAllowedOrigin(origin string, allowedOrigins []string) (string, bool) {
	for _, allowedOrigin := range allowedOrigins {
		if allowedOrigin == "*" {
			return "*", true
		}
		if origin == allowedOrigin {
			return origin, true
		}
	}

	return "", false
}
