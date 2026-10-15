package realtime

import (
	"encoding/json"
	"math"
	"strconv"
	"testing"

	chatv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func TestEncryptedSequenceJSONKeepsInt64PrecisionAcrossHTTPAndRealtime(t *testing.T) {
	for _, sequence := range []int64{9007199254740993, math.MaxInt64} {
		want := strconv.FormatInt(sequence, 10)
		for _, message := range []proto.Message{
			&chatv1.EncryptedDirectMessageV2Envelope{ServerSequence: sequence},
			&chatv1.EncryptedDirectMessageV2StoredEnvelope{ServerSequence: sequence},
			&chatv1.EncryptedGroupEnvelope{ServerSequence: sequence},
			&chatv1.EncryptedGroupStoredEnvelope{ServerSequence: sequence},
		} {
			data, err := protojson.Marshal(message)
			if err != nil {
				t.Fatal(err)
			}
			assertSequenceJSONString(t, data, "serverSequence", want)
		}
		position := &chatv1.EncryptedConversationReadPosition{MessageId: "fixture", LastReadServerSequence: sequence}
		data, err := protojson.Marshal(position)
		if err != nil {
			t.Fatal(err)
		}
		assertSequenceJSONString(t, data, "lastReadServerSequence", want)
		for _, wire := range []any{
			toEncryptedDirectMessageV2EnvelopeWire(&chatv1.EncryptedDirectMessageV2StoredEnvelope{ServerSequence: sequence}, nil, &chatv1.EncryptedDirectMessageV2DeliveryInput{}),
			toEncryptedGroupMessageV1EnvelopeWire(&chatv1.EncryptedGroupStoredEnvelope{ServerSequence: sequence}, nil, &chatv1.EncryptedGroupMessageDelivery{}),
		} {
			data, err := json.Marshal(wire)
			if err != nil {
				t.Fatal(err)
			}
			assertSequenceJSONString(t, data, "serverSequence", want)
		}
		for _, wire := range []any{toEncryptedConversationReadPositionWire(position), toEncryptedGroupReadPositionWire(position)} {
			data, err := json.Marshal(wire)
			if err != nil {
				t.Fatal(err)
			}
			assertSequenceJSONString(t, data, "lastReadServerSequence", want)
		}
	}
	if toEncryptedConversationReadPositionWire(nil) != nil || toEncryptedGroupReadPositionWire(nil) != nil {
		t.Fatal("no-target read position must remain null")
	}
}

func assertSequenceJSONString(t *testing.T, data []byte, key, want string) {
	t.Helper()
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	var got string
	if err := json.Unmarshal(fields[key], &got); err != nil || got != want {
		t.Fatalf("int64 metadata lost JSON precision/type at %s: got=%q want=%q err=%v", key, got, want, err)
	}
}
