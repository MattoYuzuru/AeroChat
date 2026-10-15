package downstream

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	chatv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1/chatv1connect"
	identityv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1/identityv1connect"
	rtcv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1/rtcv1connect"
)

type Clients struct {
	Identity        identityv1connect.IdentityServiceClient
	Chat            chatv1connect.ChatServiceClient
	RTC             rtcv1connect.RtcControlServiceClient
	readinessClient connect.HTTPClient
	readinessPeers  []readinessPeer
}

type readinessPeer struct {
	name     string
	endpoint string
}

func NewHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{Timeout: timeout}
}

func NewClients(httpClient connect.HTTPClient, identityBaseURL string, chatBaseURL string, rtcBaseURL string) *Clients {
	return &Clients{
		Identity:        identityv1connect.NewIdentityServiceClient(httpClient, identityBaseURL),
		Chat:            chatv1connect.NewChatServiceClient(httpClient, chatBaseURL),
		RTC:             rtcv1connect.NewRtcControlServiceClient(httpClient, rtcBaseURL),
		readinessClient: httpClient,
		readinessPeers: []readinessPeer{
			{name: "identity", endpoint: strings.TrimRight(identityBaseURL, "/") + "/readyz"},
			{name: "chat", endpoint: strings.TrimRight(chatBaseURL, "/") + "/readyz"},
			{name: "rtc", endpoint: strings.TrimRight(rtcBaseURL, "/") + "/readyz"},
		},
	}
}

func (c *Clients) ReadinessCheck(ctx context.Context) error {
	if c.readinessClient == nil || len(c.readinessPeers) != 3 {
		return fmt.Errorf("downstream readiness не настроена")
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	for _, peer := range c.readinessPeers {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, peer.endpoint, nil)
		if err != nil {
			return fmt.Errorf("%s downstream не готов", peer.name)
		}
		response, err := c.readinessClient.Do(request)
		if err != nil || response == nil {
			return fmt.Errorf("%s downstream не готов", peer.name)
		}
		if response.Body != nil {
			_, readErr := io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
			_ = response.Body.Close()
			if readErr != nil {
				return fmt.Errorf("%s downstream не готов", peer.name)
			}
		}
		if response.StatusCode != http.StatusOK || ctx.Err() != nil {
			return fmt.Errorf("%s downstream не готов", peer.name)
		}
	}

	return nil
}
