package identity

import (
	"context"
	"errors"
	"testing"
)

func TestWebPushRegistrationPolicyAndLegacyDelete(t *testing.T) {
	t.Parallel()
	service := newTestService()
	auth := mustRegister(t, service, "push-user", "Push User")
	for _, endpoint := range []string{"http://localhost/cap", "https://127.0.0.1/cap", "https://arbitrary.example/cap", "https://fcm.googleapis.com/cap#fragment"} {
		if err := service.UpsertWebPushSubscription(context.Background(), auth.Token, UpsertWebPushSubscriptionInput{
			Endpoint: endpoint, P256DHKey: "public-test-key", AuthSecret: "public-test-auth",
		}); !errors.Is(err, ErrInvalidArgument) {
			t.Fatal("untrusted registration must fail before persistence")
		}
	}
	repository := service.repo.(*fakeRepository)
	if len(repository.webPushSubscriptions) != 0 {
		t.Fatal("invalid endpoint persisted")
	}
	if err := service.UpsertWebPushSubscription(context.Background(), auth.Token, UpsertWebPushSubscriptionInput{
		Endpoint: "https://FCM.GOOGLEAPIS.COM:443/opaque%2Fpath?q=a%2Fb", P256DHKey: "public-test-key", AuthSecret: "public-test-auth",
	}); err != nil {
		t.Fatal(err)
	}
	for _, subscription := range repository.webPushSubscriptions {
		if subscription.Endpoint != "https://fcm.googleapis.com/opaque%2Fpath?q=a%2Fb" {
			t.Fatal("opaque capability changed")
		}
	}
	if err := service.DeleteWebPushSubscription(context.Background(), auth.Token, "https://FCM.GOOGLEAPIS.COM:443/opaque%2Fpath?q=a%2Fb"); err != nil {
		t.Fatal(err)
	}
	if len(repository.webPushSubscriptions) != 0 {
		t.Fatal("the accepted raw capability could not delete its canonical subscription")
	}
	legacy := WebPushSubscription{ID: "legacy", UserID: auth.User.ID, Endpoint: "http://localhost/legacy"}
	repository.webPushSubscriptions[legacy.ID] = legacy
	if err := service.DeleteWebPushSubscription(context.Background(), auth.Token, legacy.Endpoint); err != nil {
		t.Fatal(err)
	}
	if _, exists := repository.webPushSubscriptions[legacy.ID]; exists {
		t.Fatal("owner could not remove legacy subscription")
	}
}
