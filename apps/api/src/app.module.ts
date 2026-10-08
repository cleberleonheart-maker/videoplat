import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './common/prisma/prisma.module';
import { QueueModule } from './common/queues/queue.module';
import { StorageModule } from './common/storage/storage.service';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/auth/users/users.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { VideosModule } from './modules/videos/videos.module';
import { FeedModule } from './modules/feed/feed.module';
import { SearchModule } from './modules/search/search.module';
import { CommentsModule } from './modules/comments/comments.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { PlaylistsModule } from './modules/playlists/playlists.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    QueueModule,
    StorageModule,
    AuthModule,
    UsersModule,
    UploadsModule,
    VideosModule,
    FeedModule,
    SearchModule,
    CommentsModule,
    SubscriptionsModule,
    PlaylistsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
