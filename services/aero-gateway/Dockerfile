FROM golang:1.27.2-alpine3.24@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d AS builder

WORKDIR /src

COPY gen/go ./gen/go
COPY libs/go ./libs/go
COPY services/aero-gateway ./services/aero-gateway

WORKDIR /src/services/aero-gateway

ARG AERO_BUILD_REVISION=dev

RUN GOWORK=off go build -ldflags "-X main.version=${AERO_BUILD_REVISION}" -o /out/aero-gateway ./cmd/aero-gateway

FROM alpine:3.22

RUN adduser -D -H -u 10001 aerochat

USER aerochat
WORKDIR /app

COPY --from=builder /out/aero-gateway /app/aero-gateway

EXPOSE 8080

ENTRYPOINT ["/app/aero-gateway"]
