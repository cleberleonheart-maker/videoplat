import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { UpdateProfileDto } from '../dto/auth.dto';

const publicProfileSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarKey: true,
  bannerKey: true,
  bio: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
select: {
          ...publicProfileSelect,
          email: true,
          _count: {
            select: { videos: true, subscriptions: true, playlists: true },
          },
        },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByUsername(username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: publicProfileSelect,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id },
      data: {
        displayName: dto.displayName,
        bio: dto.bio,
      },
      select: publicProfileSelect,
    });
  }

  /**
   * Garante que o usuário tenha um canal. Chamado no primeiro upload.
   * Idempotente por causa do unique em channel.handle.
   */
  async ensureChannel(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { username: true, displayName: true },
    });

    const existing = await this.prisma.channel.findUnique({
      where: { handle: user.username },
    });
    if (existing) return existing;

    return this.prisma.channel.upsert({
      where: { handle: user.username },
      update: {},
      create: {
        handle: user.username,
        name: user.displayName,
      },
    });
  }
}
