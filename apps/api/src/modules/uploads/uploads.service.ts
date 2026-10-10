import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { UsersService } from '../auth/users/users.service';
import {
  QUEUE_NAMES,
  TranscodeJobData,
  VIDEO_JOBS,
} from '../../common/queues/queue.constants';
import { StartUploadDto, CompleteUploadDto } from './dto/upload.dto';

const ALLOWED_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const MAX_BYTES = 20 * 1024 * 1024 * 1024; // 20 GB
const PART_SIZE = 64 * 1024 * 1024; // 64 MB, mínimo do S3 para multipart

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly users: UsersService,
    @InjectQueue(QUEUE_NAMES.VIDEO) private readonly videoQueue: Queue,
  ) {}

  /**
   * Passo 1: cria o registro do vídeo e devolve as URLs pré-assinadas.
   * O browser envia os chunks direto ao S3, sem passar pela API.
   */
  async startUpload(userId: string, dto: StartUploadDto) {
    if (!ALLOWED_MIME.has(dto.contentType)) {
      throw new BadRequestException(
        `Unsupported content type: ${dto.contentType}`,
      );
    }
    if (dto.sizeBytes > MAX_BYTES) {
      throw new BadRequestException('File exceeds the 20 GB limit');
    }

    const extension = extname(dto.fileName) || '.mp4';
    const sourceKey = this.storage.sourceKeyFor(userId, extension);

    // Acima de PART_SIZE o upload usa multipart; abaixo disso o S3 recusa
    // partes de menos de 5 MB, então mandamos o arquivo inteiro de uma vez.
    const useMultipart = dto.sizeBytes > PART_SIZE;
    const partsCount = useMultipart
      ? Math.ceil(dto.sizeBytes / PART_SIZE)
      : 1;

    const channel = await this.users.ensureChannel(userId);

    const video = await this.prisma.$transaction(async (tx) => {
      const created = await tx.video.create({
        data: {
          channelId: channel.id,
          uploaderId: userId,
          title: dto.title ?? 'Sem título',
          sourceKey,
          sizeBytes: BigInt(dto.sizeBytes),
          status: 'UPLOADING',
        },
      });

      // Criada junto para o feed nunca encontrar stats nulo, mesmo com o
      // vídeo ainda em PROCESSING.
      await tx.videoStats.create({ data: { videoId: created.id } });

      return created;
    });

    const session = useMultipart
      ? await this.storage.createMultipartUpload(
          sourceKey,
          dto.contentType,
          partsCount,
        )
      : await this.storage.createSingleUpload(sourceKey, dto.contentType);

    return {
      videoId: video.id,
      mode: session.mode,
      uploadId: session.uploadId,
      objectKey: session.objectKey,
      partSize: PART_SIZE,
      partsCount,
      parts: session.parts,
    };
  }

  /**
   * Passo 2: finaliza o multipart e enfileira a transcodificação.
   * Só muda o status para READY depois que o worker terminar.
   */
  async completeUpload(userId: string, dto: CompleteUploadDto) {
    const video = await this.prisma.video.findFirst({
      where: { id: dto.videoId, uploaderId: userId },
    });
    if (!video) throw new NotFoundException('Video not found');
    if (!video.sourceKey) {
      throw new BadRequestException('Video has no source key');
    }

    // Em upload único o objeto já existe no bucket; só resta confirmar que o
    // PUT do browser chegou antes de enfileirar a transcodificação.
    if (dto.uploadId) {
      await this.storage.completeMultipartUpload(
        video.sourceKey,
        dto.uploadId,
        dto.parts,
      );
    } else {
      await this.storage.headObject(video.sourceKey);
    }

    await this.prisma.video.update({
      where: { id: video.id },
      data: {
        status: 'PROCESSING',
        title: dto.title ?? video.title,
        description: dto.description ?? video.description,
        tags: dto.tags ?? video.tags,
        visibility: dto.visibility ?? video.visibility,
        errorReason: null,
      },
    });

    const job: TranscodeJobData = {
      videoId: video.id,
      sourceKey: video.sourceKey,
      ...(typeof dto.trimStartSec === 'number'
        ? { trimStartSec: dto.trimStartSec }
        : {}),
      ...(typeof dto.trimEndSec === 'number' ? { trimEndSec: dto.trimEndSec } : {}),
      ...(typeof dto.thumbnailTimeSec === 'number'
        ? { thumbnailTimeSec: dto.thumbnailTimeSec }
        : {}),
    };
    // jobId não pode conter ":" — é o separador de namespace do Redis.
    await this.videoQueue.add(VIDEO_JOBS.TRANSCODE, job, {
      jobId: `transcode-${video.id}`,
    });

    return { videoId: video.id, status: 'PROCESSING' as const };
  }

  async abortUpload(userId: string, videoId: string, uploadId?: string) {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, uploaderId: userId },
    });
    if (!video?.sourceKey) throw new NotFoundException('Video not found');

    if (uploadId) {
      await this.storage.abortMultipartUpload(video.sourceKey, uploadId);
    }
    await this.prisma.video.delete({ where: { id: videoId } });

    return { aborted: true };
  }

  /** Reconciliação: jobs que ninguém pegou por mais de N minutos. */
  async stuckUploadsOlderThan(minutes: number) {
    const cutoff = new Date(Date.now() - minutes * 60_000);
    return this.prisma.video.findMany({
      where: { status: 'UPLOADING', createdAt: { lt: cutoff } },
      select: { id: true, sourceKey: true },
    });
  }
}

export { PART_SIZE };
