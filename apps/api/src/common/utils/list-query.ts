import { BadRequestException } from '@nestjs/common';

export const MAX_LIMIT = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normaliza os parâmetros de paginação das listagens: prende o `limit` a um
 * teto seguro (evita `?limit=1000000` derrubar a query) e valida o `cursor`
 * como UUID antes de chegar no Prisma.
 */
export function listQuery(
  limitValue: unknown,
  cursor?: string,
  fallback = 24,
  max = MAX_LIMIT,
): { limit: number; cursor?: string } {
  const parsed = Number(limitValue);
  const limit = Number.isFinite(parsed)
    ? Math.min(Math.max(1, Math.trunc(parsed)), max)
    : fallback;

  let normalizedCursor: string | undefined;
  if (cursor !== undefined && cursor !== null && cursor !== '') {
    if (!UUID_RE.test(cursor)) throw new BadRequestException('Cursor inválido');
    normalizedCursor = cursor;
  }

  return { limit, cursor: normalizedCursor };
}
