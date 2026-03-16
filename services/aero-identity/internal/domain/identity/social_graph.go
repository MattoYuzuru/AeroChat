package identity

import (
	"context"
	"fmt"
)

func (s *Service) SendFriendRequest(ctx context.Context, token string, login string) error {
	authSession, target, err := s.resolveFriendTarget(ctx, token, login)
	if err != nil {
		return err
	}

	state, err := s.repo.GetSocialGraphState(ctx, authSession.User.ID, target.ID)
	if err != nil {
		return err
	}
	if state.HasBlock {
		return fmt.Errorf("%w: blocked users cannot send friend requests", ErrConflict)
	}
	if state.AreFriends {
		return fmt.Errorf("%w: users are already friends", ErrConflict)
	}
	if state.PendingRequest != nil {
		if state.PendingRequest.RequesterUserID == authSession.User.ID {
			return fmt.Errorf("%w: outgoing friend request already exists", ErrConflict)
		}
		return fmt.Errorf("%w: incoming friend request already exists", ErrConflict)
	}

	return s.repo.CreateFriendRequest(ctx, authSession.User.ID, target.ID, s.now())
}

func (s *Service) AcceptFriendRequest(ctx context.Context, token string, login string) error {
	authSession, target, err := s.resolveFriendTarget(ctx, token, login)
	if err != nil {
		return err
	}

	state, err := s.repo.GetSocialGraphState(ctx, authSession.User.ID, target.ID)
	if err != nil {
		return err
	}
	if state.HasBlock {
		return fmt.Errorf("%w: blocked users cannot become friends", ErrConflict)
	}
	if state.AreFriends {
		return fmt.Errorf("%w: users are already friends", ErrConflict)
	}
	if state.PendingRequest == nil || state.PendingRequest.RequesterUserID != target.ID || state.PendingRequest.AddresseeUserID != authSession.User.ID {
		return ErrNotFound
	}

	ok, err := s.repo.AcceptFriendRequest(ctx, target.ID, authSession.User.ID, s.now())
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}

	return nil
}

func (s *Service) DeclineFriendRequest(ctx context.Context, token string, login string) error {
	authSession, target, err := s.resolveFriendTarget(ctx, token, login)
	if err != nil {
		return err
	}

	ok, err := s.repo.DeleteFriendRequest(ctx, target.ID, authSession.User.ID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}

	return nil
}

func (s *Service) CancelOutgoingFriendRequest(ctx context.Context, token string, login string) error {
	authSession, target, err := s.resolveFriendTarget(ctx, token, login)
	if err != nil {
		return err
	}

	ok, err := s.repo.DeleteFriendRequest(ctx, authSession.User.ID, target.ID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}

	return nil
}

func (s *Service) ListIncomingFriendRequests(ctx context.Context, token string) ([]FriendRequest, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	return s.repo.ListIncomingFriendRequests(ctx, authSession.User.ID)
}

func (s *Service) ListOutgoingFriendRequests(ctx context.Context, token string) ([]FriendRequest, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	return s.repo.ListOutgoingFriendRequests(ctx, authSession.User.ID)
}

func (s *Service) ListFriends(ctx context.Context, token string) ([]Friend, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	return s.repo.ListFriends(ctx, authSession.User.ID)
}

func (s *Service) RemoveFriend(ctx context.Context, token string, login string) error {
	authSession, target, err := s.resolveFriendTarget(ctx, token, login)
	if err != nil {
		return err
	}

	ok, err := s.repo.DeleteFriendship(ctx, authSession.User.ID, target.ID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}

	return nil
}

func (s *Service) resolveFriendTarget(ctx context.Context, token string, login string) (*SessionAuth, *User, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, nil, err
	}

	targetLogin, err := normalizeLogin(login)
	if err != nil {
		return nil, nil, err
	}
	if targetLogin == authSession.User.Login {
		return nil, nil, fmt.Errorf("%w: self-friend operation is not allowed", ErrConflict)
	}

	target, err := s.repo.GetUserByLogin(ctx, targetLogin)
	if err != nil {
		return nil, nil, err
	}

	return authSession, target, nil
}
