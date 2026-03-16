FROM golang:1.25.8-alpine AS builder

WORKDIR /src

COPY libs/go ./libs/go
COPY services/aero-rtc-control ./services/aero-rtc-control

WORKDIR /src/services/aero-rtc-control

RUN GOWORK=off go build -o /out/aero-rtc-control ./cmd/aero-rtc-control

FROM alpine:3.22

RUN adduser -D -H -u 10001 aerochat

USER aerochat
WORKDIR /app

COPY --from=builder /out/aero-rtc-control /app/aero-rtc-control

EXPOSE 8083

ENTRYPOINT ["/app/aero-rtc-control"]
