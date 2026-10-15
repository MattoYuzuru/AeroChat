FROM golang:1.27.2-alpine3.24@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d AS builder

WORKDIR /src

COPY libs/go ./libs/go
COPY services/aero-jobs ./services/aero-jobs

WORKDIR /src/services/aero-jobs

RUN GOWORK=off go build -o /out/aero-jobs ./cmd/aero-jobs

FROM alpine:3.22

RUN adduser -D -H -u 10001 aerochat

USER aerochat
WORKDIR /app

COPY --from=builder /out/aero-jobs /app/aero-jobs

EXPOSE 8084

ENTRYPOINT ["/app/aero-jobs"]
