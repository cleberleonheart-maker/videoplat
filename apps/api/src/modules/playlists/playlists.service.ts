import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class PlaylistsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, title: string, description?: string) {
    return this.prisma.playlist.create({
      data: { ownerId, title, description },
      select: { id: true, title: true, description: true, isPublic: true },
    });
  }

  async addVideo(playlistId: string, ownerId: string, videoId: string) {
    const playlist = await this.prisma.playlist.findFirst({
      where: { id: playlistId, ownerId },
      select: { id: true },
    });
    if (!playlist) throw new NotFoundException('Playlist not found');

    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      select: { id: true },
    });
    if (!video) throw new NotFoundException('Video not found');

    const existing = await this.prisma.playlistVideo.findUnique({
      where: { playlistId_videoId: { playlistId, videoId } },
      select: { id: true },
    });
    if (existing) throw new BadRequestException('Video already in playlist');

    // Posição = fim da lista, num gap de 1000 para permitir reordenar depois.
    const last = await this.prisma.playlistVideo.findFirst({
      where: { playlistId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const position = (last?.position ?? 0) + 1000;

    await this.prisma.playlistVideo.create({
      data: { playlistId, videoId, position },
    });
    return { playlistId, videoId, position };
  }

  async removeVideo(playlistId: string, ownerId: string, videoId: string) {
    const playlist = await this.prisma.playlist.findFirst({
      where: { id: playlistId, ownerId },
      select: { id: true },
    });
    if (!playlist) throw new NotFoundException('Playlist not found');

    await this.prisma.playlistVideo.deleteMany({
      where: { playlistId, videoId },
    });
    return { removed: true };
  }

  async list(userId: string) {
    return this.prisma.playlist.findMany({
      where: { OR: [{ ownerId: userId }, { isPublic: true }] },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        isPublic: true,
        _count: { select: { videos: true } },
        videos: {
          take: 3,
          orderBy: { position: 'asc' },
          select: {
            video: {
              select: {
                id: true,
                title: true,
                thumbnails: {
                  where: { label: 'hq' },
                  select: { objectKey: true },
                },
              },
            },
          },
        },
      },
    });
  }

  async get(playlistId: string, viewerId?: string) {
    const playlist = await this.prisma.playlist.findUnique({
      where: { id: playlistId },
      select: {
        id: true,
        title: true,
        description: true,
        isPublic: true,
        ownerId: true,
        videos: {
          orderBy: { position: 'asc' },
          select: {
            position: true,
            video: {
              select: {
                id: true,
                title: true,
                durationSec: true,
                channel: { select: { handle: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!playlist) throw new NotFoundException('Playlist not found');
    if (!playlist.isPublic && playlist.ownerId !== viewerId) {
      throw new NotFoundException('Playlist not found');
    }

    return playlist;
  }
}
