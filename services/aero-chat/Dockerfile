FROM golang:1.27.2-alpine3.24@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d AS builder

WORKDIR /src

COPY gen/go ./gen/go
COPY libs/go ./libs/go
COPY services/aero-chat ./services/aero-chat

WORKDIR /src/services/aero-chat

ARG AERO_BUILD_REVISION=dev

RUN GOWORK=off go build -ldflags "-X main.version=${AERO_BUILD_REVISION}" -o /out/aero-chat ./cmd/aero-chat

FROM alpine:3.22

RUN adduser -D -H -u 10001 aerochat

USER aerochat
WORKDIR /app

COPY --from=builder /out/aero-chat /app/aero-chat

EXPOSE 8082

ENTRYPOINT ["/app/aero-chat"]
