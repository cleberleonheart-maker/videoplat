import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';

@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * MVP do feed: "mais recentes" + vídeos de canais assinados.
   * Sem recomendação-personalizada ainda — isso entra depois, com
   * candidatos + embeddings.
   */
  async home(userId?: string, limit = 24) {
    const [latest, subscribed] = await Promise.all([
      this.prisma.video.findMany({
        where: { status: 'READY', visibility: 'PUBLIC' },
        orderBy: { publishedAt: 'desc' },
        take: limit,
        select: this.itemSelect,
      }),
      userId
        ? this.prisma.video.findMany({
            where: {
              status: 'READY',
              visibility: 'PUBLIC',
              channel: {
                subscriptions: { some: { subscriberId: userId } },
              },
            },
            orderBy: { publishedAt: 'desc' },
            take: limit,
            select: this.itemSelect,
          })
        : Promise.resolve([]),
    ]);

    return {
      latest: latest.map((v) => this.decorate(v)),
      subscribed: subscribed.map((v) => this.decorate(v)),
    };
  }

  private readonly itemSelect = {
    id: true,
    title: true,
    durationSec: true,
    publishedAt: true,
    channel: { select: { id: true, handle: true, name: true } },
    thumbnails: {
      where: { label: { in: ['hq', 'mq'] } },
      select: { label: true, objectKey: true },
    },
    stats: { select: { views: true, likes: true } },
  } satisfies Prisma.VideoSelect;

  private decorate(video: {
    id: string;
    title: string;
    durationSec: number | null;
    publishedAt: Date | null;
    channel: { id: string; handle: string; name: string };
    thumbnails: { label: string; objectKey: string }[];
    stats: { views: number; likes: number } | null;
  }) {
    const thumb =
      video.thumbnails.find((t) => t.label === 'hq') ?? video.thumbnails[0];

    return {
      id: video.id,
      title: video.title,
      durationSec: video.durationSec,
      publishedAt: video.publishedAt,
      channel: video.channel,
      thumbnailUrl: thumb ? this.storage.publicUrl(thumb.objectKey) : null,
      views: video.stats?.views ?? 0,
      likes: video.stats?.likes ?? 0,
    };
  }
}
