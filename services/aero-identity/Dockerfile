FROM golang:1.25.8-alpine AS builder

WORKDIR /src

COPY gen/go ./gen/go
COPY libs/go ./libs/go
COPY services/aero-identity ./services/aero-identity

WORKDIR /src/services/aero-identity

ARG AERO_BUILD_REVISION=dev

RUN GOWORK=off go build -ldflags "-X main.version=${AERO_BUILD_REVISION}" -o /out/aero-identity ./cmd/aero-identity

FROM alpine:3.22

RUN adduser -D -H -u 10001 aerochat

USER aerochat
WORKDIR /app

COPY --from=builder /out/aero-identity /app/aero-identity

EXPOSE 8081

ENTRYPOINT ["/app/aero-identity"]
