FROM node:22-bookworm-slim AS build
WORKDIR /app

# ffmpeg + ffprobe: sem isso o worker não consegue gerar HLS.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN npm install --workspaces --include-workspace-root

COPY apps/worker ./apps/worker
COPY apps/api/prisma ./apps/api/prisma
RUN npm run build --workspace @videoplat/worker \
    && npm run prisma:generate --workspace @videoplat/api

CMD ["node", "apps/worker/dist/index.js"]
