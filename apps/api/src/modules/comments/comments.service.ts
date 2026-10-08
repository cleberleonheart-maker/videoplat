import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReactionType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(videoId: string, limit = 20, cursor?: string) {
    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      select: { id: true },
    });
    if (!video) throw new NotFoundException('Video not found');

    const items = await this.prisma.comment.findMany({
      where: { videoId, parentId: null, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarKey: true,
          },
        },
        replies: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          take: 3,
          select: {
            id: true,
            body: true,
            createdAt: true,
            author: {
              select: { id: true, username: true, displayName: true, avatarKey: true },
            },
          },
        },
        _count: { select: { replies: { where: { deletedAt: null } } } },
      },
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;

    return {
      items: page.map((c) => ({
        ...c,
        avatarUrl: c.author.avatarKey
          ? this.storage.publicUrl(c.author.avatarKey)
          : null,
        author: { ...c.author, avatarKey: undefined },
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async create(videoId: string, authorId: string, body: string, parentId?: string) {
    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      select: { id: true },
    });
    if (!video) throw new NotFoundException('Video not found');

    if (parentId) {
      const parent = await this.prisma.comment.findFirst({
        where: { id: parentId, videoId, parentId: null },
      });
      if (!parent) throw new BadRequestException('Invalid parent comment');
    }

    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.comment.create({
        data: { videoId, authorId, body, parentId },
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: {
            select: { id: true, username: true, displayName: true, avatarKey: true },
          },
        },
      });

      await tx.videoStats.upsert({
        where: { videoId },
        create: { videoId, comments: 1 },
        update: { comments: { increment: 1 } },
      });

      return comment;
    });
  }

  async remove(commentId: string, requesterId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, authorId: true, videoId: true, _count: { select: { replies: true } } },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.authorId !== requesterId) {
      throw new NotFoundException('Comment not found');
    }

    await this.prisma.$transaction(async (tx) => {
      const removed = comment._count.replies + 1;
      // Soft delete em cascata manual: preserva a árvore para moderação.
      await tx.comment.updateMany({
        where: { OR: [{ id: commentId }, { parentId: commentId }] },
        data: { deletedAt: new Date() },
      });
      await tx.videoStats.updateMany({
        where: { videoId: comment.videoId },
        data: { comments: { decrement: removed } },
      });
    });

    return { deleted: true };
  }

  /** Toggle like/dislike. Chamar de novo com o mesmo tipo remove. */
  async react(videoId: string, userId: string, type: ReactionType) {
    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      select: { id: true },
    });
    if (!video) throw new NotFoundException('Video not found');

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.videoReaction.findUnique({
        where: { videoId_userId: { videoId, userId } },
      });

      if (!existing) {
        await tx.videoReaction.create({ data: { videoId, userId, type } });
        await this.adjustStats(tx, videoId, type === ReactionType.LIKE ? 1 : 0, type === ReactionType.DISLIKE ? 1 : 0);
        return { reaction: type };
      }

      if (existing.type === type) {
        await tx.videoReaction.delete({ where: { id: existing.id } });
        await this.adjustStats(tx, videoId, type === ReactionType.LIKE ? -1 : 0, type === ReactionType.DISLIKE ? -1 : 0);
        return { reaction: null };
      }

      await tx.videoReaction.update({
        where: { id: existing.id },
        data: { type },
      });
      await this.adjustStats(
        tx,
        videoId,
        existing.type === ReactionType.LIKE ? -1 : 1,
        existing.type === ReactionType.DISLIKE ? -1 : 1,
      );
      return { reaction: type };
    });
  }

  private async adjustStats(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    videoId: string,
    likeDelta: number,
    dislikeDelta: number,
  ) {
    await tx.videoStats.upsert({
      where: { videoId },
      create: {
        videoId,
        likes: Math.max(0, likeDelta),
        dislikes: Math.max(0, dislikeDelta),
      },
      update: {
        likes: { increment: likeDelta },
        dislikes: { increment: dislikeDelta },
      },
    });
  }
}
