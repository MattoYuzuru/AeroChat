FROM golang:1.27.2-alpine3.24@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d AS toolchain
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOMAXPROCS=2 GOSUMDB=sum.golang.org
RUN test "$(go env GOVERSION)" = go1.27.2

FROM scratch AS maintenance-source
COPY infra/storage/deps /maintenance/deps
COPY infra/storage/maintenance.json /maintenance/maintenance.json
COPY infra/storage/Dockerfile /maintenance/Dockerfile

FROM toolchain AS minio-build
ADD --checksum=sha256:f31b6997fdb098479ddddfca1267f02518ee0b59cc1d3f9682c3a48e6309f4d0 https://codeload.github.com/minio/minio/tar.gz/7ced9663e6a791fef9dc6be798ff24cda9c730ac /source.tar.gz
RUN mkdir /source && tar -xzf /source.tar.gz -C /source --strip-components=1
WORKDIR /source
RUN printf '%s  go.mod\n%s  go.sum\n' 1092c21cbe753941b16da2943be699d1517e70ebdd4da6d5c994ca27a85ba430 bd2c712debe48fa4406c87180609266fb92130fd0120797a29bda477a242f252 | sha256sum -c -
COPY --from=maintenance-source /maintenance/deps/minio /maintenance
RUN cp /maintenance/go.mod go.mod && cp /maintenance/go.sum go.sum && sha256sum -c /maintenance/effective.sha256
RUN go build -p 2 -mod=readonly -trimpath -ldflags '-X github.com/minio/minio/cmd.ReleaseTag=RELEASE.2025-07-23T15-54-02Z -X github.com/minio/minio/cmd.Version=2025-07-23T15:54:02Z -X github.com/minio/minio/cmd.CommitID=7ced9663e6a791fef9dc6be798ff24cda9c730ac' -o /out/minio .

FROM toolchain AS mc-build
ADD --checksum=sha256:95cd293c7119f16921a6dc515a1fb74a2227f19fd994b9c8b770a154e802ac44 https://codeload.github.com/minio/mc/tar.gz/7394ce0dd2a80935aded936b09fa12cbb3cb8096 /source.tar.gz
RUN mkdir /source && tar -xzf /source.tar.gz -C /source --strip-components=1
WORKDIR /source
RUN printf '%s  go.mod\n%s  go.sum\n' 76dbbad8795627d32a7d1a271d0b6a16a6bd4c0956262467a3b54d36ae67d622 1592c97fca12c8ccb99f3bf1a3dc3627f4449e3b29ae78c3ff84e33e2acc8bf9 | sha256sum -c -
COPY --from=maintenance-source /maintenance/deps/mc /maintenance
RUN cp /maintenance/go.mod go.mod && cp /maintenance/go.sum go.sum && sha256sum -c /maintenance/effective.sha256
RUN go build -p 2 -mod=readonly -trimpath -o /out/mc .

FROM alpine:3.23.4@sha256:5b10f432ef3da1b8d4c7eb6c487f2f5a8f096bc91145e68878dd4a5019afde11 AS minio
LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.revision="7ced9663e6a791fef9dc6be798ff24cda9c730ac" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.aerochat.storage.variant="dependency-maintenance" \
      org.aerochat.storage.go-version="1.27.2" \
      org.aerochat.storage.manifest-sha256="aef344f7135945ac80c6a7ccd8e3a10a225d0a3dca05b17b1d1d8802c5d543c0"
COPY --from=minio-build /out/minio /usr/local/bin/minio
COPY --from=minio-build /source.tar.gz /usr/share/minio/source.tar.gz
COPY --from=maintenance-source /maintenance /usr/share/minio/maintenance
COPY --from=toolchain /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
ENTRYPOINT ["minio"]

FROM alpine:3.23.4@sha256:5b10f432ef3da1b8d4c7eb6c487f2f5a8f096bc91145e68878dd4a5019afde11 AS mc
LABEL org.opencontainers.image.source="https://github.com/minio/mc" \
      org.opencontainers.image.revision="7394ce0dd2a80935aded936b09fa12cbb3cb8096" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.aerochat.storage.variant="dependency-maintenance" \
      org.aerochat.storage.go-version="1.27.2" \
      org.aerochat.storage.manifest-sha256="aef344f7135945ac80c6a7ccd8e3a10a225d0a3dca05b17b1d1d8802c5d543c0"
COPY --from=mc-build /out/mc /usr/local/bin/mc
COPY --from=mc-build /source.tar.gz /usr/share/minio/source.tar.gz
COPY --from=maintenance-source /maintenance /usr/share/minio/maintenance
COPY --from=toolchain /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
ENTRYPOINT ["mc"]
