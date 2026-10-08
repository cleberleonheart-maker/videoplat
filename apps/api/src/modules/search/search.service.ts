import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Busca por full-text do Postgres (tsvector), com fallback para ILIKE
   * quando o texto tem menos de 3 caracteres, onde o FTS não ajuda.
   */
  async search(query: string, limit = 24) {
    const trimmed = query.trim();
    if (trimmed.length < 2) return { items: [], total: 0 };

    const useFts = trimmed.length >= 3;
    const where = useFts
      ? {
          status: 'READY' as const,
          visibility: 'PUBLIC' as const,
          OR: [
            { title: { search: toTsQuery(trimmed) } },
            { description: { search: toTsQuery(trimmed) } },
            { tags: { has: trimmed.toLowerCase() } },
          ],
        }
      : {
          status: 'READY' as const,
          visibility: 'PUBLIC' as const,
          OR: [
            { title: { contains: trimmed, mode: 'insensitive' as const } },
            { channel: { handle: { contains: trimmed, mode: 'insensitive' as const } } },
          ],
        };

    const items = await this.prisma.video.findMany({
      where,
      take: limit,
      orderBy: { publishedAt: 'desc' },
      select: {
        id: true,
        title: true,
        durationSec: true,
        publishedAt: true,
        channel: { select: { handle: true, name: true } },
        thumbnails: {
          where: { label: { in: ['hq', 'mq'] } },
          select: { label: true, objectKey: true },
        },
        stats: { select: { views: true, likes: true } },
      },
    });

    return {
      total: items.length,
      items: items.map((item) => {
        const thumb =
          item.thumbnails.find((t) => t.label === 'hq') ??
          item.thumbnails[0];
        return {
          id: item.id,
          title: item.title,
          durationSec: item.durationSec,
          publishedAt: item.publishedAt,
          channel: item.channel,
          thumbnailUrl: thumb ? this.storage.publicUrl(thumb.objectKey) : null,
          views: item.stats.views,
          likes: item.stats.likes,
        };
      }),
    };
  }
}

/** Escapa para websearch_to_tsquery, que aceita texto livre. */
function toTsQuery(input: string): string {
  return input
    .replace(/[':&|!()*]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' & ');
}
