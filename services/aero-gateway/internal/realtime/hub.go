package realtime

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

var errHubClosed = errors.New("realtime hub is closed")

// Hub хранит process-local websocket-сессии и публикует user/device-scoped события.
type Hub struct {
	logger           *slog.Logger
	pingInterval     time.Duration
	writeTimeout     time.Duration
	deviceAuthorizer CryptoDeviceAuthorizer

	mu                     sync.RWMutex
	sessions               map[string]map[string]*session
	sessionsByLogin        map[string]map[string]*session
	sessionsByCryptoDevice map[string]map[string]*session
	closed                 bool
}

type session struct {
	logger              *slog.Logger
	conn                *websocket.Conn
	connectionID        string
	principal           Principal
	authToken           string
	boundCryptoDeviceID string
	outbound            chan Envelope
	ctx                 context.Context
	cancel              context.CancelFunc
	closeOnce           sync.Once
}

func NewHub(
	logger *slog.Logger,
	pingInterval time.Duration,
	writeTimeout time.Duration,
	deviceAuthorizer CryptoDeviceAuthorizer,
) *Hub {
	return &Hub{
		logger:                 logger,
		pingInterval:           pingInterval,
		writeTimeout:           writeTimeout,
		deviceAuthorizer:       deviceAuthorizer,
		sessions:               make(map[string]map[string]*session),
		sessionsByLogin:        make(map[string]map[string]*session),
		sessionsByCryptoDevice: make(map[string]map[string]*session),
	}
}

func (h *Hub) ServeConnection(conn *websocket.Conn, principal Principal, authToken string) error {
	s, err := h.register(conn, principal, authToken)
	if err != nil {
		return err
	}
	defer h.unregister(s)
	defer s.close(websocket.StatusNormalClosure, "")

	if ok := s.enqueue(newReadyEnvelope(s.connectionID, principal.UserID)); !ok {
		s.close(websocket.StatusPolicyViolation, "session closed")
		return nil
	}

	return s.run(h, h.pingInterval, h.writeTimeout)
}

func (h *Hub) PublishToUser(userID string, envelope Envelope) int {
	return h.publishFromBucket(h.userSessionsByID(userID), envelope)
}

func (h *Hub) PublishToLogin(login string, envelope Envelope) int {
	return h.publishFromBucket(h.userSessionsByLogin(login), envelope)
}

func (h *Hub) PublishToCryptoDevice(cryptoDeviceID string, envelope Envelope) int {
	return h.publishFromBucket(h.cryptoDeviceSessionsByID(cryptoDeviceID), envelope)
}

func (h *Hub) userSessionsByID(userID string) []*session {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if h.closed {
		return nil
	}

	userSessions := h.sessions[userID]
	targets := make([]*session, 0, len(userSessions))
	for _, s := range userSessions {
		targets = append(targets, s)
	}

	return targets
}

func (h *Hub) userSessionsByLogin(login string) []*session {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if h.closed {
		return nil
	}

	loginSessions := h.sessionsByLogin[login]
	targets := make([]*session, 0, len(loginSessions))
	for _, s := range loginSessions {
		targets = append(targets, s)
	}

	return targets
}

func (h *Hub) cryptoDeviceSessionsByID(cryptoDeviceID string) []*session {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if h.closed {
		return nil
	}

	deviceSessions := h.sessionsByCryptoDevice[cryptoDeviceID]
	targets := make([]*session, 0, len(deviceSessions))
	for _, s := range deviceSessions {
		targets = append(targets, s)
	}

	return targets
}

func (h *Hub) publishFromBucket(targets []*session, envelope Envelope) int {
	delivered := 0
	for _, s := range targets {
		if s.enqueue(envelope) {
			delivered++
			continue
		}

		s.close(websocket.StatusPolicyViolation, "slow consumer")
	}

	return delivered
}

func (h *Hub) Close() {
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return
	}
	h.closed = true

	targets := make([]*session, 0)
	for _, userSessions := range h.sessions {
		for _, s := range userSessions {
			targets = append(targets, s)
		}
	}
	h.mu.Unlock()

	for _, s := range targets {
		s.close(websocket.StatusGoingAway, "server shutdown")
	}
}

func (h *Hub) register(conn *websocket.Conn, principal Principal, authToken string) (*session, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.closed {
		return nil, errHubClosed
	}

	ctx, cancel := context.WithCancel(context.Background())
	s := &session{
		logger:       h.logger.With(slog.String("user_id", principal.UserID)),
		conn:         conn,
		connectionID: newEnvelopeID(),
		principal:    principal,
		authToken:    strings.TrimSpace(authToken),
		outbound:     make(chan Envelope, defaultOutboundBuffer),
		ctx:          ctx,
		cancel:       cancel,
	}

	if h.sessions[principal.UserID] == nil {
		h.sessions[principal.UserID] = make(map[string]*session)
	}
	h.sessions[principal.UserID][s.connectionID] = s
	if principal.Login != "" {
		if h.sessionsByLogin[principal.Login] == nil {
			h.sessionsByLogin[principal.Login] = make(map[string]*session)
		}
		h.sessionsByLogin[principal.Login][s.connectionID] = s
	}

	s.logger.Info(
		"realtime-сессия подключена",
		slog.String("connection_id", s.connectionID),
		slog.String("login", principal.Login),
	)

	return s, nil
}

func (h *Hub) unregister(s *session) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if userSessions, ok := h.sessions[s.principal.UserID]; ok {
		delete(userSessions, s.connectionID)
		if len(userSessions) == 0 {
			delete(h.sessions, s.principal.UserID)
		}
	}
	if s.principal.Login != "" {
		if loginSessions, ok := h.sessionsByLogin[s.principal.Login]; ok {
			delete(loginSessions, s.connectionID)
			if len(loginSessions) == 0 {
				delete(h.sessionsByLogin, s.principal.Login)
			}
		}
	}
	h.unbindSessionLocked(s)

	s.logger.Info("realtime-сессия отключена", slog.String("connection_id", s.connectionID))
}

func (h *Hub) bindSessionToCryptoDevice(s *session, cryptoDeviceID string) {
	normalizedID := strings.TrimSpace(cryptoDeviceID)
	if normalizedID == "" {
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	if h.closed {
		return
	}

	h.unbindSessionLocked(s)
	if h.sessionsByCryptoDevice[normalizedID] == nil {
		h.sessionsByCryptoDevice[normalizedID] = make(map[string]*session)
	}
	h.sessionsByCryptoDevice[normalizedID][s.connectionID] = s
	s.boundCryptoDeviceID = normalizedID
}

func (h *Hub) unbindSessionLocked(s *session) {
	if s.boundCryptoDeviceID == "" {
		return
	}

	if deviceSessions, ok := h.sessionsByCryptoDevice[s.boundCryptoDeviceID]; ok {
		delete(deviceSessions, s.connectionID)
		if len(deviceSessions) == 0 {
			delete(h.sessionsByCryptoDevice, s.boundCryptoDeviceID)
		}
	}
	s.boundCryptoDeviceID = ""
}

func (s *session) run(h *Hub, pingInterval time.Duration, writeTimeout time.Duration) error {
	readResult := make(chan error, 1)
	go s.readLoop(h, readResult)

	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-s.ctx.Done():
			return nil
		case err := <-readResult:
			if err == nil || isExpectedClose(err) || errors.Is(err, context.Canceled) {
				return nil
			}
			s.close(websocket.StatusInternalError, "read failed")
			return err
		case envelope := <-s.outbound:
			if err := s.writeEnvelope(envelope, writeTimeout); err != nil {
				s.close(websocket.StatusInternalError, "write failed")
				if isExpectedClose(err) {
					return nil
				}
				return err
			}
		case <-ticker.C:
			if err := s.ping(writeTimeout); err != nil {
				s.close(websocket.StatusGoingAway, "ping timeout")
				if isExpectedClose(err) {
					return nil
				}
				return err
			}
		}
	}
}

func (s *session) readLoop(h *Hub, result chan<- error) {
	defer close(result)

	for {
		var inbound inboundEnvelope
		if err := wsjson.Read(s.ctx, s.conn, &inbound); err != nil {
			result <- err
			return
		}
		if err := s.handleInboundEnvelope(h, inbound); err != nil {
			result <- err
			return
		}
	}
}

func (s *session) handleInboundEnvelope(h *Hub, inbound inboundEnvelope) error {
	switch strings.TrimSpace(inbound.Type) {
	case ClientEventTypeBindCryptoDevice:
		return s.handleBindCryptoDevice(h, inbound.Payload)
	case "":
		if !s.enqueue(newCryptoDeviceBindRejectedEnvelope(
			s.connectionID,
			"",
			cryptoDeviceBindRejectReasonInvalidPayload,
			"Тип client-side realtime события обязателен.",
		)) {
			s.close(websocket.StatusPolicyViolation, "session closed")
		}
		return nil
	default:
		if !s.enqueue(newCryptoDeviceBindRejectedEnvelope(
			s.connectionID,
			"",
			cryptoDeviceBindRejectReasonInvalidPayload,
			"Неподдерживаемый client-side realtime event.",
		)) {
			s.close(websocket.StatusPolicyViolation, "session closed")
		}
		return nil
	}
}

func (s *session) handleBindCryptoDevice(h *Hub, rawPayload []byte) error {
	payload, err := parseBindCryptoDevicePayload(rawPayload)
	if err != nil {
		s.enqueue(newCryptoDeviceBindRejectedEnvelope(
			s.connectionID,
			"",
			cryptoDeviceBindRejectReasonInvalidPayload,
			"Некорректный payload для bind crypto-device realtime-сессии.",
		))
		return nil
	}
	if h.deviceAuthorizer == nil {
		s.enqueue(newCryptoDeviceBindRejectedEnvelope(
			s.connectionID,
			payload.CryptoDeviceID,
			cryptoDeviceBindRejectReasonUnavailable,
			"Проверка crypto-device сейчас недоступна.",
		))
		return nil
	}

	device, err := h.deviceAuthorizer.AuthorizeActiveDevice(s.ctx, s.authToken, s.principal.UserID, payload.CryptoDeviceID)
	if err != nil {
		reason, message := bindRejectDetails(err)
		s.enqueue(newCryptoDeviceBindRejectedEnvelope(s.connectionID, payload.CryptoDeviceID, reason, message))
		return nil
	}

	h.bindSessionToCryptoDevice(s, device.ID)
	s.logger.Info(
		"realtime-сессия привязана к crypto-device",
		slog.String("connection_id", s.connectionID),
		slog.String("crypto_device_id", device.ID),
	)
	if !s.enqueue(newCryptoDeviceBoundEnvelope(s.connectionID, s.principal.UserID, device.ID)) {
		s.close(websocket.StatusPolicyViolation, "session closed")
	}

	return nil
}

func bindRejectDetails(err error) (string, string) {
	switch connect.CodeOf(err) {
	case connect.CodePermissionDenied, connect.CodeUnauthenticated:
		return cryptoDeviceBindRejectReasonPermissionDenied, "Crypto-device не принадлежит текущему аккаунту."
	case connect.CodeFailedPrecondition:
		return cryptoDeviceBindRejectReasonRejected, "Только active crypto-device может участвовать в encrypted realtime transport."
	case connect.CodeUnavailable, connect.CodeDeadlineExceeded:
		return cryptoDeviceBindRejectReasonUnavailable, "Проверка crypto-device временно недоступна."
	default:
		return cryptoDeviceBindRejectReasonRejected, "Не удалось привязать crypto-device к realtime-сессии."
	}
}

func (s *session) enqueue(envelope Envelope) bool {
	select {
	case <-s.ctx.Done():
		return false
	case s.outbound <- envelope:
		return true
	default:
		return false
	}
}

func (s *session) writeEnvelope(envelope Envelope, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	return wsjson.Write(ctx, s.conn, envelope)
}

func (s *session) ping(timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	return s.conn.Ping(ctx)
}

func (s *session) close(code websocket.StatusCode, reason string) {
	s.closeOnce.Do(func() {
		go func() {
			// Закрываем соединение вне вызывающего стека, чтобы shutdown не блокировался
			// на ожидании close handshake и не превращался в hard close из-за отмены ctx.
			defer s.cancel()
			_ = s.conn.Close(code, reason)
		}()
	})
}
