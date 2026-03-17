package realtime

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// Hub хранит process-local websocket-сессии и публикует user-scoped события.
type Hub struct {
	logger       *slog.Logger
	pingInterval time.Duration
	writeTimeout time.Duration

	mu              sync.RWMutex
	sessions        map[string]map[string]*session
	sessionsByLogin map[string]map[string]*session
	closed          bool
}

type session struct {
	logger       *slog.Logger
	conn         *websocket.Conn
	connectionID string
	principal    Principal
	outbound     chan Envelope
	ctx          context.Context
	cancel       context.CancelFunc
	closeOnce    sync.Once
}

func NewHub(logger *slog.Logger, pingInterval time.Duration, writeTimeout time.Duration) *Hub {
	return &Hub{
		logger:          logger,
		pingInterval:    pingInterval,
		writeTimeout:    writeTimeout,
		sessions:        make(map[string]map[string]*session),
		sessionsByLogin: make(map[string]map[string]*session),
	}
}

func (h *Hub) ServeConnection(conn *websocket.Conn, principal Principal) error {
	s, err := h.register(conn, principal)
	if err != nil {
		return err
	}
	defer h.unregister(s)
	defer s.close(websocket.StatusNormalClosure, "")

	if ok := s.enqueue(newReadyEnvelope(s.connectionID, principal.UserID)); !ok {
		s.close(websocket.StatusPolicyViolation, "session closed")
		return nil
	}

	return s.run(h.pingInterval, h.writeTimeout)
}

func (h *Hub) PublishToUser(userID string, envelope Envelope) int {
	return h.publishFromBucket(h.userSessionsByID(userID), envelope)
}

func (h *Hub) PublishToLogin(login string, envelope Envelope) int {
	return h.publishFromBucket(h.userSessionsByLogin(login), envelope)
}

func (h *Hub) userSessionsByID(userID string) []*session {
	h.mu.RLock()
	if h.closed {
		h.mu.RUnlock()
		return nil
	}

	userSessions := h.sessions[userID]
	targets := make([]*session, 0, len(userSessions))
	for _, s := range userSessions {
		targets = append(targets, s)
	}
	h.mu.RUnlock()

	return targets
}

func (h *Hub) userSessionsByLogin(login string) []*session {
	h.mu.RLock()
	if h.closed {
		h.mu.RUnlock()
		return nil
	}

	userSessions := h.sessionsByLogin[login]
	targets := make([]*session, 0, len(userSessions))
	for _, s := range userSessions {
		targets = append(targets, s)
	}
	h.mu.RUnlock()

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

func (h *Hub) register(conn *websocket.Conn, principal Principal) (*session, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.closed {
		return nil, errors.New("realtime hub is closed")
	}

	baseCtx, cancel := context.WithCancel(context.Background())
	ctx := conn.CloseRead(baseCtx)
	s := &session{
		logger:       h.logger.With(slog.String("user_id", principal.UserID)),
		conn:         conn,
		connectionID: newEnvelopeID(),
		principal:    principal,
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

	userSessions, ok := h.sessions[s.principal.UserID]
	if !ok {
		return
	}

	delete(userSessions, s.connectionID)
	if len(userSessions) == 0 {
		delete(h.sessions, s.principal.UserID)
	}
	if s.principal.Login != "" {
		loginSessions, ok := h.sessionsByLogin[s.principal.Login]
		if ok {
			delete(loginSessions, s.connectionID)
			if len(loginSessions) == 0 {
				delete(h.sessionsByLogin, s.principal.Login)
			}
		}
	}

	s.logger.Info("realtime-сессия отключена", slog.String("connection_id", s.connectionID))
}

func (s *session) run(pingInterval time.Duration, writeTimeout time.Duration) error {
	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-s.ctx.Done():
			return nil
		case envelope := <-s.outbound:
			if err := s.writeEnvelope(envelope, writeTimeout); err != nil {
				s.close(websocket.StatusInternalError, "write failed")
				if websocket.CloseStatus(err) == websocket.StatusNormalClosure {
					return nil
				}
				return err
			}
		case <-ticker.C:
			if err := s.ping(writeTimeout); err != nil {
				s.close(websocket.StatusGoingAway, "ping timeout")
				if websocket.CloseStatus(err) == websocket.StatusNormalClosure {
					return nil
				}
				return err
			}
		}
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
		s.cancel()
		_ = s.conn.Close(code, reason)
	})
}
