package connecthandler

import (
	"context"
	"net/http"

	"connectrpc.com/connect"
)

func forwardUnary[Req any, Res any](
	ctx context.Context,
	incoming *connect.Request[Req],
	call func(context.Context, *connect.Request[Req]) (*connect.Response[Res], error),
) (*connect.Response[Res], error) {
	outgoing := connect.NewRequest(incoming.Msg)
	copyAuthorizationHeader(outgoing.Header(), incoming.Header())

	response, err := call(ctx, outgoing)
	if err != nil {
		return nil, err
	}

	proxied := connect.NewResponse(response.Msg)
	copyHeader(proxied.Header(), response.Header())
	copyHeader(proxied.Trailer(), response.Trailer())

	return proxied, nil
}

func copyAuthorizationHeader(dst http.Header, src http.Header) {
	values := src.Values("Authorization")
	if len(values) == 0 {
		return
	}

	dst.Del("Authorization")
	for _, value := range values {
		dst.Add("Authorization", value)
	}
}

func copyHeader(dst http.Header, src http.Header) {
	for key, values := range src {
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}
