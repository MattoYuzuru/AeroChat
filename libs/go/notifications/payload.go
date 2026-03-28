package notifications

const (
	WebPushPayloadVersion    = "v1"
	WebPushKindDirectMessage = "direct_message"
	WebPushKindGroupMessage  = "group_message"
	WebPushKindFriendRequest = "friend_request"
)

type WebPushPayload struct {
	Version   string `json:"version"`
	Kind      string `json:"kind"`
	Title     string `json:"title"`
	ActorName string `json:"actorName,omitempty"`
	Preview   string `json:"preview,omitempty"`
	Route     string `json:"route"`
	Tag       string `json:"tag"`
	SentAt    string `json:"sentAt,omitempty"`
}
