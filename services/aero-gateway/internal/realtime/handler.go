package realtime

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/coder/websocket"
)

type Handler struct {
	logger         *slog.Logger
	authenticator  Authenticator
	hub            *Hub
	allowedOrigins []string
}

func NewHandler(logger *slog.Logger, authenticator Authenticator, hub *Hub, allowedOrigins []string) *Handler {
	return &Handler{
		logger:         logger,
		authenticator:  authenticator,
		hub:            hub,
		allowedOrigins: allowedOrigins,
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	token, err := tokenFromRequest(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	principal, err := h.authenticator.Authenticate(r.Context(), token)
	if err != nil {
		h.logger.Warn("websocket-аутентификация отклонена", slog.Int("status_code", authHTTPStatus(err)))
		http.Error(w, "Не удалось подтвердить websocket-сессию.", authHTTPStatus(err))
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: sanitizeOriginPatterns(h.allowedOrigins),
		Subprotocols:   []string{Protocol},
	})
	if err != nil {
		h.logger.Warn("websocket upgrade отклонён", slog.String("error", err.Error()))
		return
	}
	defer func() {
		_ = conn.CloseNow()
	}()

	if conn.Subprotocol() != Protocol {
		_ = conn.Close(websocket.StatusPolicyViolation, "missing realtime protocol")
		return
	}

	if err := h.hub.ServeConnection(conn, principal); err != nil && !isExpectedClose(err) {
		h.logger.Warn(
			"realtime-сессия завершилась с ошибкой",
			slog.String("user_id", principal.UserID),
			slog.String("error", err.Error()),
		)
	}
}

func tokenFromRequest(r *http.Request) (string, error) {
	subprotocols := strings.Split(r.Header.Get("Sec-WebSocket-Protocol"), ",")
	hasRealtimeProtocol := false

	for _, candidate := range subprotocols {
		value := strings.TrimSpace(candidate)
		switch {
		case value == Protocol:
			hasRealtimeProtocol = true
		case strings.HasPrefix(value, authProtocolPrefix):
			token := strings.TrimSpace(strings.TrimPrefix(value, authProtocolPrefix))
			if token == "" {
				return "", errors.New("websocket session token is empty")
			}
			if !hasRealtimeProtocol && containsProtocol(subprotocols, Protocol) {
				hasRealtimeProtocol = true
			}
			if !hasRealtimeProtocol {
				return "", errors.New("websocket realtime protocol is required")
			}
			return token, nil
		}
	}

	if !hasRealtimeProtocol {
		return "", errors.New("websocket realtime protocol is required")
	}

	return "", errors.New("websocket session token is required")
}

func containsProtocol(values []string, protocol string) bool {
	for _, candidate := range values {
		if strings.TrimSpace(candidate) == protocol {
			return true
		}
	}

	return false
}

func sanitizeOriginPatterns(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		result = append(result, trimmed)
	}

	return result
}

func isExpectedClose(err error) bool {
	switch websocket.CloseStatus(err) {
	case websocket.StatusNormalClosure, websocket.StatusGoingAway, websocket.StatusNoStatusRcvd:
		return true
	default:
		return false
	}
}
