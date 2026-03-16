module github.com/MattoYuzuru/AeroChat/services/aero-identity

go 1.25.0

require (
	github.com/MattoYuzuru/AeroChat/libs/go v0.0.0
	github.com/jackc/pgx/v5 v5.8.0
)

require (
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	golang.org/x/text v0.29.0 // indirect
)

replace github.com/MattoYuzuru/AeroChat/libs/go => ../../libs/go
