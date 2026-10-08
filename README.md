# VideoPlat

Esqueleto de uma plataforma de vídeo estilo YouTube (MVP).

## Stack

| Camada | Escolha |
| --- | --- |
| Frontend | Next.js 15 (App Router) + TypeScript + hls.js |
| API | NestJS 11 + Prisma + PostgreSQL |
| Fila | BullMQ (Redis) |
| Encoding | Worker Node + FFmpeg → HLS multi-rendição + thumbnails |
| Storage | S3 (MinIO em dev), upload multipart pré-assinado |

## Estrutura

```
apps/
  api/     NestJS: auth, vídeos, uploads, feed, busca, comentários,
           inscrições, playlists
  worker/  BullMQ + FFmpeg: transcodifica HLS, gera thumbnails, grava stats
  web/     Next.js: home, /watch, /search, /login, /upload
```

## Rodando localmente

```bash
cp .env.example .env
npm install
docker compose up -d postgres redis minio minio-init
npm run db:generate
npm run db:push
npm run dev          # api + worker + web
```

| Serviço | URL |
| --- | --- |
| Web | http://localhost:3000 |
| API | http://localhost:4000/api |
| Swagger | http://localhost:4000/api/docs |
| MinIO console | http://localhost:9001 |

Sem Docker: instale `postgresql`, `redis` e `ffmpeg` no host e ajuste o
`.env`.

## Como o fluxo de upload funciona

1. `POST /api/uploads/initiate` — cria o registro do vídeo e devolve URLs
   pré-assinadas (uma por chunk de 64 MB).
2. O browser envia os chunks **direto para o S3**, em 4 conexões paralelas,
   reportando o progresso localmente. A API não passa a rota de dados.
3. `POST /api/uploads/complete` — fecha o multipart e enfileira o job
   `transcode`.
4. O worker baixa a fonte, faz `ffprobe`, escolhe as variantes (nunca acima
   da resolução de origem), transcodifica para HLS com `-force_key_frames`
   alinhado aos segmentos, gera os thumbnails e sobe tudo no bucket público.
5. O banco muda `status` de `PROCESSING` para `READY`; só então
   `/api/videos/:id/playback` devolve as variantes.

## Segurança

- Símbolos internos das fontes ficam no bucket `-source`, que não recebe
  permissão anônima. Só o bucket de mídia processada é público.
- Upload é autorizado por JWT + `uploaderId` na query, não pelo payload.
- Argon2id com verificação contra um hash descartável no login, para não
  vazar quais emails existem.

## Cobertura

**Feito:** auth JWT, upload multipart + transcodificação HLS, player com
adaptive streaming, feed, busca full-text, comentários com thread,
reactions, inscrições, playlists, métricas de views.

**Não feito (MVP):** recomendação personalizada (apenas "mais recentes" e
"do que você inscreveu"), Shorts, legendas, moderação, notificações,
shorts/relatos ao vivo, refresh token com rotação.

## Notas de ambiente

- `ffmpeg`/`ffprobe` são obrigatórios no worker.
- `apps/web` usa o pacote WASM do SWC como fallback quando a binária nativa
  não suporta a CPU.
