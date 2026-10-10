#!/usr/bin/env bash
#
# Deploy do site VideoPlat para o EC2 (Caddy + Docker Compose).
#
# Uso:
#   scripts/deploy.sh                 # rebuilda web e api (padrão)
#   scripts/deploy.sh web             # só o serviço web
#   scripts/deploy.sh web api worker  # serviços específicos
#
# Configurável por variáveis de ambiente:
#   DEPLOY_HOST      padrão: ubuntu@18.216.119.208
#   DEPLOY_KEY       padrão: <repo>/videoplat.pem
#   DEPLOY_PATH      padrão: /home/ubuntu/videoplat
#   DEPLOY_SERVICES  padrão: "web api"
#   DRY_RUN=1        só mostra o que seria enviado, sem alterar o servidor
#
# O que faz:
#   1. envia o código (rsync, sem node_modules/build/.env/*.pem)
#   2. recompila e reinicia os serviços no Docker Compose de produção
#   3. mostra o status dos containers
#
# Observação: o container "api" roda "prisma db push" no start, então
# mudanças de schema do Prisma são aplicadas automaticamente.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEPLOY_HOST="${DEPLOY_HOST:-ubuntu@18.216.119.208}"
DEPLOY_KEY="${DEPLOY_KEY:-$REPO_ROOT/videoplat.pem}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/ubuntu/videoplat}"
SERVICES="${*:-${DEPLOY_SERVICES:-web api}}"

if [[ ! -f "$DEPLOY_KEY" ]]; then
  echo "erro: chave SSH não encontrada em $DEPLOY_KEY" >&2
  echo "defina DEPLOY_KEY=/caminho/para/chave.pem se estiver em outro lugar" >&2
  exit 1
fi
chmod 600 "$DEPLOY_KEY" 2>/dev/null || true

SSH_OPTS=(-i "$DEPLOY_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
SSH=(ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST")

RSYNC_FLAGS=(-az)
if [[ "${DRY_RUN:-0}" == "1" ]]; then
  RSYNC_FLAGS+=(-n --itemize-changes)
fi

echo "==> Enviando código para $DEPLOY_HOST:$DEPLOY_PATH"
rsync "${RSYNC_FLAGS[@]}" \
  --exclude 'node_modules' --exclude '.git' --exclude '.next' --exclude 'dist' \
  --exclude 'build' --exclude '.gradle' --exclude '.kotlin' \
  --exclude '*.apk' --exclude '*.pem' --exclude '*.tsbuildinfo' --exclude '.env' \
  -e "ssh ${SSH_OPTS[*]}" \
  "$REPO_ROOT/" "$DEPLOY_HOST:$DEPLOY_PATH/"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "==> DRY_RUN: pulando build."
  exit 0
fi

echo "==> Rebuildando e reiniciando: $SERVICES"
"${SSH[@]}" "cd '$DEPLOY_PATH' && sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build $SERVICES"

echo "==> Status dos containers"
"${SSH[@]}" 'sudo docker ps --format "{{.Names}}\t{{.Status}}" | sort'

echo "==> Deploy concluído."
