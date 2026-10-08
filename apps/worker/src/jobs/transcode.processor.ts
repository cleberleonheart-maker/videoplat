import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { S3Client } from '@aws-sdk/client-s3';
import {
  buildMasterPlaylist,
  cleanup,
  download,
  probe,
  putText,
  safeSegment,
  S3Config,
  TranscodeResult,
  transcodeRendition,
  uploadDir,
} from '../pipeline/ffmpeg';
import { generateThumbnails } from '../pipeline/thumbnails';
import { RENDITIONS } from '../pipeline/renditions';
import { QUEUE_NAMES, TranscodeJobData, VIDEO_JOBS } from './constants';

const logger = new Logger('TranscodeProcessor');

const segmentSeconds = Number(process.env.HLS_SEGMENT_SECONDS ?? 6);

export function createS3Config(): S3Config {
  const bucket = process.env.S3_BUCKET!;
  return {
    client: new S3Client({
      region: process.env.S3_REGION ?? 'us-east-1',
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET_KEY!,
      },
    }),
    sourceBucket: `${bucket}-source`,
    outputBucket: bucket,
  };
}

/**
 * Escolhe as variantes que fazem sentido para o fonte: nunca gerar acima da
 * resolução original, porque o upscale só gasta bits sem ganho visual.
 */
function renditionsFor(sourceHeight: number, isVertical: boolean) {
  return RENDITIONS.filter((r) =>
    isVertical ? r.height <= sourceHeight : r.width <= sourceHeight * (16 / 9),
  );
}

export async function processTranscode(
  prisma: PrismaClient,
  s3: S3Config,
  data: TranscodeJobData,
): Promise<void> {
  const { videoId, sourceKey } = data;
  const workDir = join(tmpdir(), `videoplat-${videoId}`);
  const sourceDir = join(workDir, 'source');
  const outputDir = join(workDir, 'hls');
  const prefix = `videos/${videoId}`;

  await prisma.video.update({
    where: { id: videoId },
    data: { status: 'PROCESSING', errorReason: null },
  });

  await mkdir(workDir, { recursive: true });

  try {
    logger.log(`[${videoId}] probing source`);
    const meta = await probe(sourceKey, sourceDir, s3);

    // Fontes sem áudio ou muito curtas quebram o filter_complex do master.
    const specs = renditionsFor(meta.height, meta.isVertical);
    if (specs.length === 0) {
      throw new Error(
        `Unsupported resolution: ${meta.width}x${meta.height}`,
      );
    }

    logger.log(
      `[${videoId}] ${meta.width}x${meta.height} ${meta.durationSec}s ` +
        `→ ${specs.length} rendition(s)`,
    );

    await mkdir(outputDir, { recursive: true });

    // Sequencial de propósito: encodes de 1080p em paralelo estouram CPU
    // e disco. A paralelização real é entre jobs, via concorrência do worker.
    const results: TranscodeResult[] = [];
    for (const spec of specs) {
      results.push(
        await transcodeRendition({
          inputFile: meta.inputPath,
          outputDir,
          rendition: spec,
          segmentSeconds,
          hasAudio: meta.hasAudio,
          isVertical: meta.isVertical,
        }),
      );
    }

    // Cada variante vai para o seu próprio prefixo (hls/720p/...), senão
    // todas se sobrescrevem em hls/ e o master vira 404.
    for (const result of results) {
      await uploadDir(
        s3,
        `${prefix}/hls/${safeSegment(result.label)}`,
        result.dir,
      );
    }

    await putText(
      s3,
      `${prefix}/hls/master.m3u8`,
      buildMasterPlaylist(results),
      'application/vnd.apple.mpegurl',
    );

    const thumbnails = await generateThumbnails(
      meta.inputPath,
      outputDir,
      meta.durationSec,
      s3,
      prefix,
    );

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.videoRendition.deleteMany({ where: { videoId } });
      await tx.videoRendition.createMany({
        data: results.map((r) => {
          const spec = specs.find((s) => s.label === r.label)!;
          return {
            videoId,
            label: r.label,
            width: spec.width,
            height: spec.height,
            bitrateKbps: spec.bitrateKbps,
            playlistKey: `${prefix}/hls/${r.label}/index.m3u8`,
          };
        }),
      });

      await tx.videoThumbnail.deleteMany({ where: { videoId } });
      await tx.videoThumbnail.createMany({
        data: thumbnails.map((t) => ({
          videoId,
          label: t.label,
          objectKey: t.objectKey,
          width: t.width,
          height: t.height,
        })),
      });

      await tx.video.update({
        where: { id: videoId },
        data: {
          status: 'READY',
          durationSec: Math.round(meta.durationSec),
          width: meta.width,
          height: meta.height,
          publishedAt: new Date(),
          errorReason: null,
        },
      });

      await tx.videoStats.upsert({
        where: { videoId },
        create: { videoId },
        update: {},
      });
    });

    logger.log(`[${videoId}] ready`);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message.slice(0, 500) : 'unknown error';

    logger.error(`[${videoId}] failed: ${reason}`);

    await prisma.video.update({
      where: { id: videoId },
      data: { status: 'FAILED', errorReason: reason },
    });

    throw error;
  } finally {
    await cleanup(workDir);
  }
}

export { QUEUE_NAMES, VIDEO_JOBS, TranscodeJobData };
