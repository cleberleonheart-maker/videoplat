import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { QUEUE_NAMES } from './queue.constants';

/** Conexão ioredis compartilhada (fora do BullMQ) para rate limit etc. */
export const IO_REDIS = 'IO_REDIS';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: { age: 3_600, count: 1_000 },
          removeOnFail: { age: 86_400 },
        },
      }),
    }),
    BullModule.registerQueue({ name: QUEUE_NAMES.VIDEO }),
  ],
  providers: [
    {
      provide: IO_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis(config.getOrThrow<string>('REDIS_URL'), {
          // Falha rápido quando o Redis some, em vez de enfileirar comandos.
          maxRetriesPerRequest: 2,
          enableOfflineQueue: false,
        }),
    },
  ],
  exports: [BullModule, IO_REDIS],
})
export class QueueModule {}
