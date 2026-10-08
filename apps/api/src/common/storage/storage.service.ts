import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  CreateMultipartUploadCommand,
  S3Client,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  UploadPartCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

export interface PresignedPart {
  partNumber: number;
  url: string;
}

/**
 * `multipart` envia por partes (arquivos grandes).
 * `single` envia o arquivo inteiro numa única URL PUT.
 */
export interface MultipartSession {
  mode: 'multipart' | 'single';
  uploadId: string | null;
  objectKey: string;
  parts: PresignedPart[];
}

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  readonly sourceBucket: string;

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.get<string>('S3_ENDPOINT');
    this.bucket = this.config.getOrThrow<string>('S3_BUCKET');
    this.publicBaseUrl = this.config
      .get<string>('PUBLIC_MEDIA_URL')
      .replace(/\/$/, '');
    // Fontes (arquivo original) ficam em bucket separado e privado:
    // nunca são servidos publicamente.
    this.sourceBucket = `${this.bucket}-source`;

    this.client = new S3Client({
      region: this.config.get<string>('S3_REGION', 'us-east-1'),
      endpoint,
      forcePathStyle: this.config.get('S3_FORCE_PATH_STYLE') === 'true',
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('S3_ACCESS_KEY'),
        secretAccessKey: this.config.getOrThrow<string>('S3_SECRET_KEY'),
      },
    });
  }

  /** URL pública de um objeto já processado (rendition, thumbnail). */
  publicUrl(objectKey: string): string {
    return `${this.publicBaseUrl}/${objectKey}`;
  }

  /** Só devolve caminho; a CDN resolve a URL final. */
  assetKey(...parts: string[]): string {
    return parts.join('/');
  }

  sourceKeyFor(userId: string, extension: string): string {
    return `${userId}/${randomUUID()}/source${extension}`;
  }

  /** Upload único (arquivos menores que um chunk). */
  async createSingleUpload(
    objectKey: string,
    contentType: string,
    bucket = this.sourceBucket,
  ): Promise<MultipartSession> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        ContentType: contentType,
      }),
      { expiresIn: 60 * 60 * 6 },
    );

    return {
      mode: 'single',
      uploadId: null,
      objectKey,
      parts: [{ partNumber: 1, url }],
    };
  }

  async createMultipartUpload(
    objectKey: string,
    contentType: string,
    partsCount: number,
    bucket = this.sourceBucket,
  ): Promise<MultipartSession> {
    const created = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: objectKey,
        ContentType: contentType,
      }),
    );

    const parts = await Promise.all(
      Array.from({ length: partsCount }, (_, index) => {
        const partNumber = index + 1;
        return getSignedUrl(
          this.client,
          new UploadPartCommand({
            Bucket: bucket,
            Key: objectKey,
            UploadId: created.UploadId,
            PartNumber: partNumber,
          }),
          { expiresIn: 60 * 60 * 6 },
        ).then((url) => ({ partNumber, url }));
      }),
    );

    return { mode: 'multipart', uploadId: created.UploadId, objectKey, parts };
  }

  async completeMultipartUpload(
    objectKey: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
    bucket = this.sourceBucket,
  ): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: objectKey,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
  }

  async abortMultipartUpload(objectKey: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.sourceBucket,
        Key: objectKey,
        UploadId: uploadId,
      }),
    );
  }

  async headObject(objectKey: string, bucket = this.sourceBucket) {
    return this.client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: objectKey }),
    );
  }

  /** Usado pelo worker para gravar a saída do FFmpeg diretamente no S3. */
  get rawClient(): S3Client {
    return this.client;
  }
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
