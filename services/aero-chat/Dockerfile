FROM golang:1.25.8-alpine AS builder

WORKDIR /src

COPY libs/go ./libs/go
COPY services/aero-chat ./services/aero-chat

WORKDIR /src/services/aero-chat

RUN GOWORK=off go build -o /out/aero-chat ./cmd/aero-chat

FROM alpine:3.22

RUN adduser -D -H -u 10001 aerochat

USER aerochat
WORKDIR /app

COPY --from=builder /out/aero-chat /app/aero-chat

EXPOSE 8082

ENTRYPOINT ["/app/aero-chat"]
