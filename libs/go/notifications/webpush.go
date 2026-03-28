package notifications

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	httpClient  *http.Client
	subscriber  string
	publicKey   string
	privateKey  string
	ttlSeconds  int
}

func NewWebPushClient(httpClient *http.Client, subscriber string, publicKey string, privateKey string) *WebPushClient {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 10 * time.Second}
	}

	return &WebPushClient{
		httpClient: httpClient,
		subscriber: strings.TrimSpace(subscriber),
		publicKey:  strings.TrimSpace(publicKey),
		privateKey: strings.TrimSpace(privateKey),
		ttlSeconds: defaultPushTTLSeconds,
	}
}

func (c *WebPushClient) Enabled() bool {
	return c != nil && c.publicKey != "" && c.privateKey != "" && c.subscriber != ""
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

	message, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal web push payload: %w", err)
	}

	var invalidSubscriptionIDs []string
	var sendErrors []error
	for _, subscription := range subscriptions {
		if strings.TrimSpace(subscription.Endpoint) == "" {
			continue
		}

		response, sendErr := webpush.SendNotificationWithContext(
			ctx,
			message,
			&webpush.Subscription{
				Endpoint: subscription.Endpoint,
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
		if response != nil {
			_ = response.Body.Close()
		}
		if sendErr == nil {
			continue
		}

		if response != nil && (response.StatusCode == http.StatusGone || response.StatusCode == http.StatusNotFound) {
			invalidSubscriptionIDs = append(invalidSubscriptionIDs, subscription.ID)
			continue
		}

		sendErrors = append(sendErrors, fmt.Errorf("endpoint %s: %w", subscription.Endpoint, sendErr))
	}

	return invalidSubscriptionIDs, errors.Join(sendErrors...)
}
