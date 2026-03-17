module github.com/MattoYuzuru/AeroChat/services/aero-gateway

go 1.25.0

require (
	connectrpc.com/connect v1.19.1
	github.com/MattoYuzuru/AeroChat/gen/go v0.0.0
	github.com/MattoYuzuru/AeroChat/libs/go v0.0.0
	google.golang.org/protobuf v1.36.11
)

require github.com/coder/websocket v1.8.14 // indirect

replace github.com/MattoYuzuru/AeroChat/gen/go => ../../gen/go

replace github.com/MattoYuzuru/AeroChat/libs/go => ../../libs/go
