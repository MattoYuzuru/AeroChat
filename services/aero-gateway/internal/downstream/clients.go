package downstream

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"connectrpc.com/connect"
	chatv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1"
	chatv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1/chatv1connect"
	identityv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1"
	identityv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1/identityv1connect"
	rtcv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1"
	rtcv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1/rtcv1connect"
)

type Clients struct {
	Identity identityv1connect.IdentityServiceClient
	Chat     chatv1connect.ChatServiceClient
	RTC      rtcv1connect.RtcControlServiceClient
}

func NewHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{Timeout: timeout}
}

func NewClients(httpClient connect.HTTPClient, identityBaseURL string, chatBaseURL string, rtcBaseURL string) *Clients {
	return &Clients{
		Identity: identityv1connect.NewIdentityServiceClient(httpClient, identityBaseURL),
		Chat:     chatv1connect.NewChatServiceClient(httpClient, chatBaseURL),
		RTC:      rtcv1connect.NewRtcControlServiceClient(httpClient, rtcBaseURL),
	}
}

func (c *Clients) ReadinessCheck(ctx context.Context) error {
	if _, err := c.Identity.Ping(ctx, connect.NewRequest(&identityv1.PingRequest{})); err != nil {
		return fmt.Errorf("identity downstream недоступен: %w", err)
	}
	if _, err := c.Chat.Ping(ctx, connect.NewRequest(&chatv1.PingRequest{})); err != nil {
		return fmt.Errorf("chat downstream недоступен: %w", err)
	}
	if _, err := c.RTC.Ping(ctx, connect.NewRequest(&rtcv1.PingRequest{})); err != nil {
		return fmt.Errorf("rtc downstream недоступен: %w", err)
	}

	return nil
}
