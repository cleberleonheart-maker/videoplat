# MinIO removeu as imagens públicas do Docker Hub, então montamos a nossa a
# partir do release oficial publicado no GitHub. Binários são estáticos (Go),
# então a imagem precisa apenas de libc.
FROM debian:bookworm-slim

ARG MINIO_RELEASE=RELEASE.2025-09-07T16-13-09Z
ARG MC_RELEASE=RELEASE.2025-08-13T08-35-41Z

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL -o /usr/local/bin/minio \
      "https://github.com/minio/minio/releases/download/${MINIO_RELEASE}/minio.linux-amd64.${MINIO_RELEASE}" \
    && curl -fsSL -o /usr/local/bin/mc \
      "https://github.com/minio/mc/releases/download/${MC_RELEASE}/mc.linux-amd64.${MC_RELEASE}" \
    && chmod +x /usr/local/bin/minio /usr/local/bin/mc

EXPOSE 9000 9001
VOLUME ["/data"]

ENTRYPOINT ["minio"]
