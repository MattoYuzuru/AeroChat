package connecthandler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"connectrpc.com/connect"
	rtcv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1"
	rtcconnect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1/rtcv1connect"
)

func TestPublicMediaControlRemainsUnmountedAndUnimplemented(t *testing.T) {
	handler := NewHandler("fixture", "source-only", nil)
	_, oldService := rtcconnect.NewRtcControlServiceHandler(handler)
	request := httptest.NewRequest(http.MethodPost, "/aerochat.rtc.v1.GroupMediaControlService/RequestGroupMediaEnd", strings.NewReader("{}"))
	response := httptest.NewRecorder()
	oldService.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatal("new service mounted on legacy route")
	}
	// Даже отдельно созданный typed handler не превращает body/header в authority.
	leave := connect.NewRequest(&rtcv1.RequestGroupMediaLeaveRequest{CallId: "fixture", RequestId: "fixture"})
	leave.Header().Set("Authorization", "Bearer synthetic-fixture")
	if _, err := handler.RequestGroupMediaLeave(context.Background(), leave); connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatal(err)
	}
	if _, err := handler.RequestGroupMediaEnd(context.Background(), connect.NewRequest(&rtcv1.RequestGroupMediaEndRequest{})); connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatal(err)
	}
	if _, err := handler.GetGroupMediaOperation(context.Background(), connect.NewRequest(&rtcv1.GetGroupMediaOperationRequest{})); connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatal(err)
	}
}
