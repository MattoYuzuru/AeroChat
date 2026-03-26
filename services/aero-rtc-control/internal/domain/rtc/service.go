package rtc

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Repository interface {
	GetCallByID(context.Context, string) (*Call, error)
	GetActiveCallByScope(context.Context, ConversationScope) (*Call, error)
	GetActiveParticipationByUserID(context.Context, string) (*ActiveParticipation, error)
	CreateCallWithParticipant(context.Context, Call, CallParticipant) (*Call, *CallParticipant, error)
	CreateParticipant(context.Context, CallParticipant) (*CallParticipant, error)
	GetActiveParticipant(context.Context, string, string) (*CallParticipant, error)
	ListActiveParticipants(context.Context, string) ([]CallParticipant, error)
	LeaveParticipant(context.Context, string, time.Time) (bool, error)
	LeaveActiveParticipantsByCallID(context.Context, string, time.Time) error
	TouchParticipantSignal(context.Context, string, time.Time) error
	CountActiveParticipants(context.Context, string) (int64, error)
	EndCall(context.Context, string, *string, string, time.Time) (bool, error)
}

type Authenticator interface {
	Authenticate(context.Context, string) (*AuthenticatedUser, error)
}

type ScopeAuthorizer interface {
	GetScopeAccess(context.Context, string, ConversationScope) (*ScopeAccess, error)
}

type Service struct {
	repo                 Repository
	authenticator        Authenticator
	scopeAuthorizer      ScopeAuthorizer
	iceServerProvider    ICEServerProvider
	maxSignalPayloadSize int
	now                  func() time.Time
	newID                func() string
}

func NewService(repo Repository, authenticator Authenticator, scopeAuthorizer ScopeAuthorizer, maxSignalPayloadSize int) *Service {
	if maxSignalPayloadSize <= 0 {
		maxSignalPayloadSize = maxSignalRelayPayloadBytes
	}

	return &Service{
		repo:                 repo,
		authenticator:        authenticator,
		scopeAuthorizer:      scopeAuthorizer,
		maxSignalPayloadSize: maxSignalPayloadSize,
		now: func() time.Time {
			return time.Now().UTC()
		},
		newID: func() string {
			return uuid.NewString()
		},
	}
}

func (s *Service) WithICEServerProvider(provider ICEServerProvider) *Service {
	s.iceServerProvider = provider
	return s
}

func (s *Service) GetICEServers(ctx context.Context, token string) ([]ICEServer, error) {
	user, err := s.authenticator.Authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	if s.iceServerProvider == nil {
		return nil, nil
	}

	return s.iceServerProvider.BuildForUser(user.ID, s.now()), nil
}

func (s *Service) GetActiveCall(ctx context.Context, token string, scope ConversationScope) (*Call, error) {
	if _, err := s.authorizeScope(ctx, token, scope, false); err != nil {
		return nil, err
	}

	call, err := s.repo.GetActiveCallByScope(ctx, scope)
	if errors.Is(err, ErrNotFound) {
		return nil, nil
	}

	return call, err
}

func (s *Service) GetCall(ctx context.Context, token string, callID string) (*Call, error) {
	callID, err := normalizeID(callID, "call_id")
	if err != nil {
		return nil, err
	}

	call, err := s.repo.GetCallByID(ctx, callID)
	if err != nil {
		return nil, err
	}

	if _, err := s.authorizeScope(ctx, token, call.Scope, false); err != nil {
		return nil, err
	}

	return call, nil
}

func (s *Service) StartCall(ctx context.Context, token string, scope ConversationScope) (*Call, *CallParticipant, error) {
	user, access, err := s.authorizeForActiveParticipation(ctx, token, scope)
	if err != nil {
		return nil, nil, err
	}

	if err := s.ensureNoOtherActiveParticipation(ctx, user.ID, ""); err != nil {
		return nil, nil, err
	}

	if _, err := s.repo.GetActiveCallByScope(ctx, access.Scope); err == nil {
		return nil, nil, fmt.Errorf("%w: active call already exists for scope", ErrConflict)
	} else if !errors.Is(err, ErrNotFound) {
		return nil, nil, err
	}

	now := s.now()
	call := Call{
		ID:              s.newID(),
		Scope:           access.Scope,
		CreatedByUserID: user.ID,
		Status:          CallStatusActive,
		CreatedAt:       now,
		UpdatedAt:       now,
		StartedAt:       now,
	}
	participant := CallParticipant{
		ID:        s.newID(),
		CallID:    call.ID,
		UserID:    user.ID,
		State:     ParticipantStateActive,
		JoinedAt:  now,
		UpdatedAt: now,
	}

	createdCall, createdParticipant, err := s.repo.CreateCallWithParticipant(ctx, call, participant)
	if err != nil {
		if errors.Is(err, ErrConflict) {
			if conflictErr := s.resolveActiveParticipationConflict(ctx, user.ID, ""); conflictErr != nil {
				return nil, nil, conflictErr
			}
		}

		return nil, nil, err
	}

	return createdCall, createdParticipant, nil
}

func (s *Service) JoinCall(ctx context.Context, token string, callID string) (*Call, *CallParticipant, error) {
	call, user, _, err := s.authorizeCallForActiveParticipation(ctx, token, callID)
	if err != nil {
		return nil, nil, err
	}

	existing, err := s.repo.GetActiveParticipant(ctx, call.ID, user.ID)
	if err == nil {
		updatedCall, getErr := s.repo.GetCallByID(ctx, call.ID)
		if getErr != nil {
			return nil, nil, getErr
		}

		return updatedCall, existing, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return nil, nil, err
	}

	if err := s.ensureNoOtherActiveParticipation(ctx, user.ID, call.ID); err != nil {
		return nil, nil, err
	}

	now := s.now()
	participant, err := s.repo.CreateParticipant(ctx, CallParticipant{
		ID:        s.newID(),
		CallID:    call.ID,
		UserID:    user.ID,
		State:     ParticipantStateActive,
		JoinedAt:  now,
		UpdatedAt: now,
	})
	if err != nil {
		if errors.Is(err, ErrConflict) {
			if conflictErr := s.resolveActiveParticipationConflict(ctx, user.ID, call.ID); conflictErr != nil {
				return nil, nil, conflictErr
			}

			participant, retryErr := s.repo.GetActiveParticipant(ctx, call.ID, user.ID)
			if retryErr != nil {
				return nil, nil, retryErr
			}
			call, retryErr = s.repo.GetCallByID(ctx, call.ID)
			if retryErr != nil {
				return nil, nil, retryErr
			}

			return call, participant, nil
		}

		return nil, nil, err
	}

	call, err = s.repo.GetCallByID(ctx, call.ID)
	if err != nil {
		return nil, nil, err
	}

	return call, participant, nil
}

func (s *Service) ensureNoOtherActiveParticipation(ctx context.Context, userID string, allowedCallID string) error {
	participation, err := s.repo.GetActiveParticipationByUserID(ctx, userID)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if allowedCallID != "" && participation.Call.ID == allowedCallID {
		return nil
	}

	return &ActiveCallConflictError{
		Call:        participation.Call,
		Participant: participation.Participant,
	}
}

func (s *Service) resolveActiveParticipationConflict(ctx context.Context, userID string, allowedCallID string) error {
	participation, err := s.repo.GetActiveParticipationByUserID(ctx, userID)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if allowedCallID != "" && participation.Call.ID == allowedCallID {
		return nil
	}

	return &ActiveCallConflictError{
		Call:        participation.Call,
		Participant: participation.Participant,
	}
}

func (s *Service) LeaveCall(ctx context.Context, token string, callID string) (*Call, *CallParticipant, error) {
	call, user, _, err := s.authorizeCallView(ctx, token, callID)
	if err != nil {
		return nil, nil, err
	}

	participant, err := s.repo.GetActiveParticipant(ctx, call.ID, user.ID)
	if err != nil {
		return nil, nil, err
	}

	now := s.now()
	updated, err := s.repo.LeaveParticipant(ctx, participant.ID, now)
	if err != nil {
		return nil, nil, err
	}
	if !updated {
		return nil, nil, fmt.Errorf("%w: participant is not active", ErrConflict)
	}

	participant.State = ParticipantStateLeft
	participant.LeftAt = &now
	participant.UpdatedAt = now

	activeCount, err := s.repo.CountActiveParticipants(ctx, call.ID)
	if err != nil {
		return nil, nil, err
	}

	if activeCount == 0 {
		if _, err := s.repo.EndCall(ctx, call.ID, nil, CallEndReasonLastParticipant, now); err != nil {
			return nil, nil, err
		}
	}

	call, err = s.repo.GetCallByID(ctx, call.ID)
	if err != nil {
		return nil, nil, err
	}

	return call, participant, nil
}

func (s *Service) EndCall(ctx context.Context, token string, callID string) (*Call, []CallParticipant, error) {
	call, user, _, err := s.authorizeCallView(ctx, token, callID)
	if err != nil {
		return nil, nil, err
	}
	if call.CreatedByUserID != user.ID {
		return nil, nil, fmt.Errorf("%w: only call creator can end call", ErrPermissionDenied)
	}
	if call.Status != CallStatusActive {
		return nil, nil, fmt.Errorf("%w: call is not active", ErrConflict)
	}

	affected, err := s.repo.ListActiveParticipants(ctx, call.ID)
	if err != nil {
		return nil, nil, err
	}

	now := s.now()
	if err := s.repo.LeaveActiveParticipantsByCallID(ctx, call.ID, now); err != nil {
		return nil, nil, err
	}
	if _, err := s.repo.EndCall(ctx, call.ID, &user.ID, CallEndReasonManual, now); err != nil {
		return nil, nil, err
	}

	for index := range affected {
		affected[index].State = ParticipantStateLeft
		affected[index].LeftAt = &now
		affected[index].UpdatedAt = now
	}

	call, err = s.repo.GetCallByID(ctx, call.ID)
	if err != nil {
		return nil, nil, err
	}

	return call, affected, nil
}

func (s *Service) ListCallParticipants(ctx context.Context, token string, callID string) ([]CallParticipant, error) {
	call, _, _, err := s.authorizeCallView(ctx, token, callID)
	if err != nil {
		return nil, err
	}

	return s.repo.ListActiveParticipants(ctx, call.ID)
}

func (s *Service) SendSignal(ctx context.Context, token string, callID string, targetUserID string, signalType string, payload []byte) (*SignalEnvelope, error) {
	call, user, _, err := s.authorizeCallForActiveParticipation(ctx, token, callID)
	if err != nil {
		return nil, err
	}

	targetUserID, err = normalizeID(targetUserID, "target_user_id")
	if err != nil {
		return nil, err
	}
	if user.ID == targetUserID {
		return nil, fmt.Errorf("%w: target_user_id must reference another participant", ErrInvalidArgument)
	}
	if err := validateSignalType(signalType); err != nil {
		return nil, err
	}
	if len(payload) == 0 {
		return nil, fmt.Errorf("%w: signal payload is required", ErrInvalidArgument)
	}
	if len(payload) > s.maxSignalPayloadSize {
		return nil, fmt.Errorf("%w: signal payload exceeds max size", ErrInvalidArgument)
	}

	senderParticipant, err := s.repo.GetActiveParticipant(ctx, call.ID, user.ID)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.GetActiveParticipant(ctx, call.ID, targetUserID); err != nil {
		return nil, err
	}

	now := s.now()
	if err := s.repo.TouchParticipantSignal(ctx, senderParticipant.ID, now); err != nil {
		return nil, err
	}

	return &SignalEnvelope{
		CallID:       call.ID,
		FromUserID:   user.ID,
		TargetUserID: targetUserID,
		Type:         signalType,
		Payload:      append([]byte(nil), payload...),
		CreatedAt:    now,
	}, nil
}

func (s *Service) authorizeCallView(ctx context.Context, token string, callID string) (*Call, *AuthenticatedUser, *ScopeAccess, error) {
	callID, err := normalizeID(callID, "call_id")
	if err != nil {
		return nil, nil, nil, err
	}

	call, err := s.repo.GetCallByID(ctx, callID)
	if err != nil {
		return nil, nil, nil, err
	}

	user, err := s.authenticator.Authenticate(ctx, token)
	if err != nil {
		return nil, nil, nil, err
	}

	access, err := s.scopeAuthorizer.GetScopeAccess(ctx, token, call.Scope)
	if err != nil {
		return nil, nil, nil, err
	}

	return call, user, access, nil
}

func (s *Service) authorizeCallForActiveParticipation(ctx context.Context, token string, callID string) (*Call, *AuthenticatedUser, *ScopeAccess, error) {
	call, user, access, err := s.authorizeCallView(ctx, token, callID)
	if err != nil {
		return nil, nil, nil, err
	}
	if call.Status != CallStatusActive {
		return nil, nil, nil, fmt.Errorf("%w: call is not active", ErrConflict)
	}
	if err := ensureCanActivelyParticipate(access); err != nil {
		return nil, nil, nil, err
	}

	return call, user, access, nil
}

func (s *Service) authorizeScope(ctx context.Context, token string, scope ConversationScope, requireActiveParticipation bool) (*ScopeAccess, error) {
	if _, err := s.authenticator.Authenticate(ctx, token); err != nil {
		return nil, err
	}

	scope, err := normalizeScope(scope)
	if err != nil {
		return nil, err
	}

	access, err := s.scopeAuthorizer.GetScopeAccess(ctx, token, scope)
	if err != nil {
		return nil, err
	}
	if requireActiveParticipation {
		if err := ensureCanActivelyParticipate(access); err != nil {
			return nil, err
		}
	}

	return access, nil
}

func (s *Service) authorizeForActiveParticipation(ctx context.Context, token string, scope ConversationScope) (*AuthenticatedUser, *ScopeAccess, error) {
	user, err := s.authenticator.Authenticate(ctx, token)
	if err != nil {
		return nil, nil, err
	}

	scope, err = normalizeScope(scope)
	if err != nil {
		return nil, nil, err
	}

	access, err := s.scopeAuthorizer.GetScopeAccess(ctx, token, scope)
	if err != nil {
		return nil, nil, err
	}
	if err := ensureCanActivelyParticipate(access); err != nil {
		return nil, nil, err
	}

	return user, access, nil
}

func normalizeScope(scope ConversationScope) (ConversationScope, error) {
	switch scope.Type {
	case ScopeTypeDirect:
		directChatID, err := normalizeID(scope.DirectChatID, "direct_chat_id")
		if err != nil {
			return ConversationScope{}, err
		}
		if strings.TrimSpace(scope.GroupID) != "" {
			return ConversationScope{}, fmt.Errorf("%w: group_id must be empty for direct scope", ErrInvalidArgument)
		}

		return ConversationScope{Type: ScopeTypeDirect, DirectChatID: directChatID}, nil
	case ScopeTypeGroup:
		groupID, err := normalizeID(scope.GroupID, "group_id")
		if err != nil {
			return ConversationScope{}, err
		}
		if strings.TrimSpace(scope.DirectChatID) != "" {
			return ConversationScope{}, fmt.Errorf("%w: direct_chat_id must be empty for group scope", ErrInvalidArgument)
		}

		return ConversationScope{Type: ScopeTypeGroup, GroupID: groupID}, nil
	default:
		return ConversationScope{}, fmt.Errorf("%w: unsupported scope type", ErrInvalidArgument)
	}
}

func normalizeID(value string, field string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", fmt.Errorf("%w: %s is required", ErrInvalidArgument, field)
	}
	if _, err := uuid.Parse(trimmed); err != nil {
		return "", fmt.Errorf("%w: %s must be a valid UUID", ErrInvalidArgument, field)
	}

	return trimmed, nil
}

func ensureCanActivelyParticipate(access *ScopeAccess) error {
	if access == nil {
		return fmt.Errorf("%w: scope access is required", ErrUnauthorized)
	}
	if access.Scope.Type == ScopeTypeGroup && access.GroupRole == GroupRoleReader {
		return fmt.Errorf("%w: group reader cannot actively participate in calls", ErrPermissionDenied)
	}

	return nil
}

func validateSignalType(signalType string) error {
	switch signalType {
	case SignalTypeOffer, SignalTypeAnswer, SignalTypeICECandidate:
		return nil
	default:
		return fmt.Errorf("%w: unsupported signal type", ErrInvalidArgument)
	}
}
