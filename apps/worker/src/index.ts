import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import IORedis from 'ioredis';
import {
  QUEUE_NAMES,
  TranscodeJobData,
  VIDEO_JOBS,
} from './jobs/constants';
import {
  createS3Config,
  processTranscode,
} from './jobs/transcode.processor';

const logger = new Logger('Worker');

async function main() {
  const concurrency = Number(process.env.ENCODE_CONCURRENCY ?? 2);

  const redis = new IORedis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
  });

  const prisma = new PrismaClient();
  await prisma.$connect();

  const s3 = createS3Config();

  const worker = new Worker<TranscodeJobData>(
    QUEUE_NAMES.VIDEO,
    async (job) => {
      if (job.name !== VIDEO_JOBS.TRANSCODE) {
        logger.warn(`Ignorando job desconhecido: ${job.name}`);
        return;
      }
      await processTranscode(prisma, s3, job.data);
    },
    {
      connection: redis,
      concurrency,
      // Transcodificação de vídeo é lenta; sem lock longo o BullMQ pode
      // entregar o mesmo job para outro worker.
      lockDuration: 10 * 60_000,
    },
  );

  worker.on('completed', (job) => {
    logger.log(`Job ${job.id} (${job.name}) concluído`);
  });

  worker.on('failed', (job, error) => {
    logger.error(`Job ${job?.id} falhou: ${error.message}`);
  });

  worker.on('error', (error) => {
    logger.error(`Worker error: ${error.message}`);
  });

  logger.log(
    `Worker ativo — fila "${QUEUE_NAMES.VIDEO}", concorrência ${concurrency}`,
  );

  const shutdown = async (signal: string) => {
    logger.log(`${signal} recebido, encerrando...`);
    await worker.close();
    await prisma.$disconnect();
    await redis.quit();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
