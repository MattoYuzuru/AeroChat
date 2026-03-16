module github.com/MattoYuzuru/AeroChat/services/aero-chat

go 1.25.0

require (
	connectrpc.com/connect v1.19.1
	github.com/MattoYuzuru/AeroChat/gen/go v0.0.0
	github.com/MattoYuzuru/AeroChat/libs/go v0.0.0
	github.com/google/uuid v1.6.0
	github.com/jackc/pgx/v5 v5.8.0
	github.com/redis/go-redis/v9 v9.16.0
	google.golang.org/protobuf v1.36.11
)

require (
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/dgryski/go-rendezvous v0.0.0-20200823014737-9f7001d12a5f // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	golang.org/x/sync v0.20.0 // indirect
	golang.org/x/text v0.35.0 // indirect
)

replace github.com/MattoYuzuru/AeroChat/gen/go => ../../gen/go

replace github.com/MattoYuzuru/AeroChat/libs/go => ../../libs/go
