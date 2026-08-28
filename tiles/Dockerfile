# syntax=docker/dockerfile:1

########################
# Stage 1: fetch pmtiles binary + bake the merged archive
########################
FROM debian:bookworm-slim AS builder

ARG PMTILES_VERSION=1.31.2
ARG TARGETARCH
ARG PROTOMAPS_BUILD_DATE=""

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# go-pmtiles' Linux release assets name amd64 as "x86_64", not Docker's "amd64".
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) PMTILES_ARCH=x86_64 ;; \
      arm64) PMTILES_ARCH=arm64 ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/go-pmtiles.tar.gz \
      "https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_Linux_${PMTILES_ARCH}.tar.gz"; \
    tar -xzf /tmp/go-pmtiles.tar.gz -C /usr/local/bin pmtiles; \
    chmod +x /usr/local/bin/pmtiles; \
    rm /tmp/go-pmtiles.tar.gz

WORKDIR /build
RUN set -eux; \
    BUILD_DATE="${PROTOMAPS_BUILD_DATE:-$(date -u -d 'yesterday' +%Y%m%d)}"; \
    echo "Baking archive from Protomaps build ${BUILD_DATE}"; \
    pmtiles extract \
      "https://build.protomaps.com/${BUILD_DATE}.pmtiles" \
      /build/dryroute.pmtiles \
      --bbox=99.5,-2.0,104.6,6.8; \
    pmtiles show /build/dryroute.pmtiles

########################
# Stage 2: minimal runtime
########################
FROM alpine:3.20 AS runtime

COPY --from=builder /usr/local/bin/pmtiles /usr/local/bin/pmtiles
COPY --from=builder /build/dryroute.pmtiles /data/dryroute.pmtiles
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV PORT=8081
ENV PUBLIC_URL=""

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider "http://127.0.0.1:${PORT}/" || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
