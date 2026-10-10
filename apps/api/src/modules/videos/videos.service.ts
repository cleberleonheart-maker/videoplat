import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VideoVisibility } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { UpdateVideoDto } from './dto/video.dto';

const cardSelect = {
  id: true,
  title: true,
  durationSec: true,
  publishedAt: true,
  visibility: true,
  status: true,
  channel: { select: { id: true, handle: true, name: true, avatarKey: true } },
  thumbnails: {
    where: { label: { in: ['hq', 'mq'] } },
    select: { label: true, objectKey: true, width: true, height: true },
  },
  stats: { select: { views: true, likes: true } },
} satisfies Prisma.VideoSelect;

export interface VideoCard {
  id: string;
  title: string;
  durationSec: number | null;
  channel: { id: string; handle: string; name: string };
  thumbnailUrl: string | null;
  views: number;
  likes: number;
}

@Injectable()
export class VideosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** O player precisa do master playlist mais leve possível. */
  async getPlayback(videoId: string) {
    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        title: true,
        durationSec: true,
        status: true,
        visibility: true,
        renditions: {
          select: {
            label: true,
            width: true,
            height: true,
            bitrateKbps: true,
            playlistKey: true,
          },
          orderBy: { height: 'desc' },
        },
      },
    });

    if (!video) throw new NotFoundException('Video not found');
    if (video.status !== 'READY') {
      throw new NotFoundException('Video is not ready for playback');
    }

    return {
      videoId: video.id,
      title: video.title,
      durationSec: video.durationSec,
      // O master é o que o player deve carregar; ele faz o ABR entre as
      // variantes listadas em sources.
      masterUrl: this.storage.publicUrl(`videos/${video.id}/hls/master.m3u8`),
      sources: video.renditions.map((r) => ({
        label: r.label,
        width: r.width,
        height: r.height,
        bitrateKbps: r.bitrateKbps,
        // URL absoluta: o master referencia as variantes com caminhos
        // relativos e a CDN precisa resolvê-los.
        url: this.storage.publicUrl(r.playlistKey),
      })),
    };
  }

  async getById(videoId: string, viewerId?: string) {
    // Reações e inscrição dependem do token; sem token não há userId para
    // filtrar, então as subselects simplesmente ficam de fora do select.
    const channelSelect = {
      id: true,
      handle: true,
      name: true,
      avatarKey: true,
      ...(viewerId
        ? {
            subscriptions: {
              where: { subscriberId: viewerId },
              select: { id: true },
            },
          }
        : {}),
    };

    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      select: {
        ...cardSelect,
        channel: { select: channelSelect },
        description: true,
        tags: true,
        uploaderId: true,
        stats: {
          select: { views: true, likes: true, dislikes: true, comments: true },
        },
        ...(viewerId
          ? {
              reactions: {
                where: { userId: viewerId },
                select: { type: true },
              },
            }
          : {}),
      } as Prisma.VideoSelect,
    });

    if (!video) throw new NotFoundException('Video not found');
    // Vídeo privado só é visível para o dono (e para quem tem o link exato).
    if (video.visibility === VideoVisibility.PRIVATE) {
      if (video.uploaderId !== viewerId) {
        throw new NotFoundException('Video not found');
      }
    }

    return this.decorate(video);
  }

  async listMine(uploaderId: string, limit = 48, cursor?: string) {
    const items = await this.prisma.video.findMany({
      where: { uploaderId },
      select: cardSelect,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    return this.paginate(
      items.map((item) => this.decorate(item)),
      limit,
    );
  }

  async listByChannel(channelHandle: string, limit = 24, cursor?: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { handle: channelHandle },
      select: { id: true },
    });
    if (!channel) throw new NotFoundException('Channel not found');

    const items = await this.prisma.video.findMany({
      where: {
        channelId: channel.id,
        status: 'READY',
        visibility: VideoVisibility.PUBLIC,
      },
      select: cardSelect,
      orderBy: { publishedAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    return this.paginate(
      items.map((item) => this.decorate(item)),
      limit,
    );
  }

  async update(videoId: string, uploaderId: string, dto: UpdateVideoDto) {
    const existing = await this.prisma.video.findFirst({
      where: { id: videoId, uploaderId },
    });
    if (!existing) throw new NotFoundException('Video not found');

    return this.prisma.video.update({
      where: { id: videoId },
      data: {
        title: dto.title,
        description: dto.description,
        visibility: dto.visibility,
      },
      select: { id: true, title: true, description: true, visibility: true },
    });
  }

  async remove(videoId: string, uploaderId: string) {
    const existing = await this.prisma.video.findFirst({
      where: { id: videoId, uploaderId },
    });
    if (!existing) throw new NotFoundException('Video not found');
    await this.prisma.video.delete({ where: { id: videoId } });
    return { deleted: true };
  }

  async registerView(videoId: string, userId?: string, ipHash?: string) {
    await this.prisma.$transaction([
      this.prisma.videoView.create({ data: { videoId, userId, ipHash } }),
      this.prisma.videoStats.upsert({
        where: { videoId },
        create: { videoId, views: 1 },
        update: { views: { increment: 1 } },
      }),
    ]);
    return { recorded: true };
  }

  private decorate(video: any) {
    const thumb =
      video.thumbnails?.find((t: any) => t.label === 'hq') ??
      video.thumbnails?.[0];

    const { thumbnails, reactions, ...rest } = video;

    // stats só existe depois que o worker termina; um vídeo em PROCESSING
    // ainda não tem linha em video_stats.
    const stats = video.stats ?? { views: 0, likes: 0, dislikes: 0, comments: 0 };

    return {
      ...rest,
      channel: video.channel
        ? { ...video.channel, subscriptions: undefined }
        : video.channel,
      thumbnailUrl: thumb ? this.storage.publicUrl(thumb.objectKey) : null,
      stats: {
        ...stats,
        likes: stats.likes - (stats.dislikes ?? 0),
      },
      viewerReaction: reactions?.[0]?.type ?? null,
      subscribed: Boolean(video.channel?.subscriptions?.length),
    };
  }

  private paginate<T extends { id: string; publishedAt: Date | null }>(
    items: T[],
    limit: number,
  ) {
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return {
      items: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }
}
