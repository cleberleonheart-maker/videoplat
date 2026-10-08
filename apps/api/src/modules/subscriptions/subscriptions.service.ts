import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async subscribe(subscriberId: string, handle: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { handle },
      select: { id: true },
    });
    if (!channel) throw new NotFoundException('Channel not found');

    await this.prisma.subscription.upsert({
      where: {
        channelId_subscriberId: {
          channelId: channel.id,
          subscriberId,
        },
      },
      update: {},
      create: { channelId: channel.id, subscriberId },
    });

    const count = await this.prisma.subscription.count({
      where: { channelId: channel.id },
    });
    return { subscribed: true, subscriberCount: count };
  }

  async unsubscribe(subscriberId: string, handle: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { handle },
      select: { id: true },
    });
    if (!channel) throw new NotFoundException('Channel not found');

    await this.prisma.subscription.deleteMany({
      where: { channelId: channel.id, subscriberId },
    });

    const count = await this.prisma.subscription.count({
      where: { channelId: channel.id },
    });
    return { subscribed: false, subscriberCount: count };
  }

  async listSubscribedChannels(userId: string) {
    return this.prisma.subscription.findMany({
      where: { subscriberId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        channel: {
          select: {
            id: true,
            handle: true,
            name: true,
            avatarKey: true,
            _count: { select: { videos: true, subscriptions: true } },
          },
        },
      },
    });
  }
}
