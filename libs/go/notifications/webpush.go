package notifications

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

const defaultPushTTLSeconds = 300

type Subscription struct {
	ID         string
	Endpoint   string
	P256DHKey  string
	AuthSecret string
}

type WebPushClient struct {
	httpClient   *http.Client
	subscriber   string
	publicKey    string
	privateKey   string
	ttlSeconds   int
	batchTimeout time.Duration
}

func MissingWebPushConfigFields(subscriber string, publicKey string, privateKey string) []string {
	missing := make([]string, 0, 3)
	if strings.TrimSpace(subscriber) == "" {
		missing = append(missing, "AERO_WEB_PUSH_SUBSCRIBER")
	}
	if strings.TrimSpace(publicKey) == "" {
		missing = append(missing, "AERO_WEB_PUSH_VAPID_PUBLIC_KEY")
	}
	if strings.TrimSpace(privateKey) == "" {
		missing = append(missing, "AERO_WEB_PUSH_VAPID_PRIVATE_KEY")
	}

	return missing
}

func WebPushConfigEnabled(subscriber string, publicKey string, privateKey string) bool {
	return len(MissingWebPushConfigFields(subscriber, publicKey, privateKey)) == 0
}

func ValidateWebPushConfig(subscriber string, publicKey string, privateKey string) error {
	missing := MissingWebPushConfigFields(subscriber, publicKey, privateKey)
	if len(missing) == 0 || len(missing) == 3 {
		return nil
	}

	return fmt.Errorf("неполная web push конфигурация: отсутствуют %s", strings.Join(missing, ", "))
}

func NewWebPushClient(subscriber string, publicKey string, privateKey string) *WebPushClient {
	dialer := &net.Dialer{Timeout: pushDialTimeout, KeepAlive: -1}
	return &WebPushClient{
		httpClient:   newPushHTTPClient(net.DefaultResolver.LookupNetIP, dialer.DialContext),
		subscriber:   strings.TrimSpace(subscriber),
		publicKey:    strings.TrimSpace(publicKey),
		privateKey:   strings.TrimSpace(privateKey),
		ttlSeconds:   defaultPushTTLSeconds,
		batchTimeout: pushBatchTimeout,
	}
}

func (c *WebPushClient) Enabled() bool {
	return c != nil && WebPushConfigEnabled(c.subscriber, c.publicKey, c.privateKey)
}

func (c *WebPushClient) PublicKey() string {
	if c == nil {
		return ""
	}

	return c.publicKey
}

func (c *WebPushClient) SendJSON(
	ctx context.Context,
	subscriptions []Subscription,
	topic string,
	payload any,
) ([]string, error) {
	if !c.Enabled() || len(subscriptions) == 0 {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(ctx, c.batchTimeout)
	defer cancel()

	message, err := json.Marshal(payload)
	if err != nil {
		return nil, errors.New("web push payload encoding failed")
	}

	var invalidSubscriptionIDs []string
	var sendErrors []error
	for _, subscription := range subscriptions {
		if ctx.Err() != nil {
			sendErrors = append(sendErrors, errors.New("web push batch interrupted"))
			break
		}
		endpoint, err := NormalizeWebPushEndpoint(subscription.Endpoint)
		if err != nil {
			invalidSubscriptionIDs = append(invalidSubscriptionIDs, subscription.ID)
			sendErrors = append(sendErrors, ErrWebPushEndpoint)
			continue
		}

		response, sendErr := webpush.SendNotificationWithContext(
			ctx,
			message,
			&webpush.Subscription{
				Endpoint: endpoint,
				Keys: webpush.Keys{
					P256dh: subscription.P256DHKey,
					Auth:   subscription.AuthSecret,
				},
			},
			&webpush.Options{
				HTTPClient:      c.httpClient,
				Subscriber:      c.subscriber,
				Topic:           strings.TrimSpace(topic),
				TTL:             c.ttlSeconds,
				Urgency:         webpush.UrgencyHigh,
				VAPIDPublicKey:  c.publicKey,
				VAPIDPrivateKey: c.privateKey,
			},
		)
		if response != nil && response.Body != nil {
			_ = response.Body.Close()
		}
		if sendErr != nil || response == nil {
			sendErrors = append(sendErrors, errors.New("web push request failed"))
			continue
		}

		if response != nil && (response.StatusCode == http.StatusGone || response.StatusCode == http.StatusNotFound) {
			invalidSubscriptionIDs = append(invalidSubscriptionIDs, subscription.ID)
			continue
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			sendErrors = append(sendErrors, errors.New("web push provider did not accept request"))
		}
	}

	return invalidSubscriptionIDs, errors.Join(sendErrors...)
}
