FROM golang:1.25.8-alpine@sha256:8e02eb337d9e0ea459e041f1ee5eece41cbb61f1d83e7d883a3e2fb4862063fa AS toolchain
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOMAXPROCS=2

FROM toolchain AS minio-build
ADD --checksum=sha256:f31b6997fdb098479ddddfca1267f02518ee0b59cc1d3f9682c3a48e6309f4d0 https://codeload.github.com/minio/minio/tar.gz/7ced9663e6a791fef9dc6be798ff24cda9c730ac /source.tar.gz
RUN mkdir /source && tar -xzf /source.tar.gz -C /source --strip-components=1
WORKDIR /source
RUN go build -p 2 -mod=readonly -trimpath -ldflags '-X github.com/minio/minio/cmd.ReleaseTag=RELEASE.2025-07-23T15-54-02Z -X github.com/minio/minio/cmd.Version=2025-07-23T15:54:02Z -X github.com/minio/minio/cmd.CommitID=7ced9663e6a791fef9dc6be798ff24cda9c730ac' -o /out/minio .

FROM toolchain AS mc-build
ADD --checksum=sha256:95cd293c7119f16921a6dc515a1fb74a2227f19fd994b9c8b770a154e802ac44 https://codeload.github.com/minio/mc/tar.gz/7394ce0dd2a80935aded936b09fa12cbb3cb8096 /source.tar.gz
RUN mkdir /source && tar -xzf /source.tar.gz -C /source --strip-components=1
WORKDIR /source
RUN go build -p 2 -mod=readonly -trimpath -o /out/mc .

FROM alpine:3.23.4@sha256:5b10f432ef3da1b8d4c7eb6c487f2f5a8f096bc91145e68878dd4a5019afde11 AS minio
LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.revision="7ced9663e6a791fef9dc6be798ff24cda9c730ac" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=minio-build /out/minio /usr/local/bin/minio
COPY --from=minio-build /source.tar.gz /usr/share/minio/source.tar.gz
COPY --from=toolchain /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
ENTRYPOINT ["minio"]

FROM alpine:3.23.4@sha256:5b10f432ef3da1b8d4c7eb6c487f2f5a8f096bc91145e68878dd4a5019afde11 AS mc
LABEL org.opencontainers.image.source="https://github.com/minio/mc" \
      org.opencontainers.image.revision="7394ce0dd2a80935aded936b09fa12cbb3cb8096" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=mc-build /out/mc /usr/local/bin/mc
COPY --from=mc-build /source.tar.gz /usr/share/minio/source.tar.gz
COPY --from=toolchain /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
ENTRYPOINT ["mc"]
