import { spawn } from 'child_process';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { RenditionSpec } from './renditions';

export interface S3Config {
  client: S3Client;
  sourceBucket: string;
  outputBucket: string;
}

export interface ProbeResult {
  /** Caminho local do fonte, já baixado do S3. */
  inputPath: string;
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  /** Vídeo vertical: as variantes passam a ser escaladas por altura. */
  isVertical: boolean;
}

export function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let tail = '';
    proc.stderr.on('data', (buf: Buffer) => {
      // FFmpeg usa \r para o progresso; guarda só o final para o erro.
      tail = (tail + buf.toString()).slice(-4000);
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve('');
      else reject(new Error(`ffmpeg exited with ${code}\n${tail}`));
    });
  });
}

export async function probe(
  sourceKey: string,
  localPath: string,
  s3: S3Config,
): Promise<ProbeResult> {
  const inputPath = await download(s3, s3.sourceBucket, sourceKey, localPath);

  const raw = await new Promise<string>((resolve, reject) => {
    const proc = spawn(
      process.env.FFPROBE_PATH ?? 'ffprobe',
      [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        inputPath,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    proc.stdout.on('data', (b) => (out += b.toString()));
    proc.stderr.on('data', (b) => (err += b.toString()));
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`ffprobe exited with ${code}: ${err}`)),
    );
  });

  const parsed = JSON.parse(raw) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type: string;
      width?: number;
      height?: number;
    }>;
  };

  const video = parsed.streams?.find((s) => s.codec_type === 'video');
  if (!video) throw new Error('Source has no video stream');

  const width = video.width ?? 0;
  const height = video.height ?? 0;

  return {
    inputPath,
    durationSec: Number(parsed.format?.duration ?? 0),
    width,
    height,
    hasAudio: parsed.streams?.some((s) => s.codec_type === 'audio') ?? false,
    isVertical: height > width,
  };
}

/** Baixa a fonte para disco: o FFmpeg precisa de um caminho seekable. */
export async function download(
  s3: S3Config,
  bucket: string,
  key: string,
  destinationDir: string,
): Promise<string> {
  await mkdir(destinationDir, { recursive: true });
  const target = join(destinationDir, key.split('/').pop() ?? 'source');
  const res = await s3.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  await pipeline(res.Body as Readable, createWriteStream(target));
  return target;
}

export function safeSegment(label: string): string {
  return label.replace(/[^a-z0-9-]/gi, '_');
}

export interface TranscodeInput {
  inputFile: string;
  outputDir: string;
  rendition: RenditionSpec;
  segmentSeconds: number;
  hasAudio: boolean;
  isVertical: boolean;
}

export interface TranscodeResult {
  label: string;
  dir: string;
  bandwidth: number;
  attributes: string;
}

export async function transcodeRendition(
  input: TranscodeInput,
): Promise<TranscodeResult> {
  const { rendition } = input;
  const dir = join(input.outputDir, safeSegment(rendition.label));
  await mkdir(dir, { recursive: true });

  // Vertical escala pela altura, horizontal pela largura. -2 preserva o
  // aspect ratio e arredonda para um número par (H.264 exige dimensões pares).
  const scale = input.isVertical
    ? `scale=-2:min(${rendition.height}\\,ih)`
    : `scale=-2:min(${rendition.width}\\,iw)`;

  const args = [
    '-y',
    '-i', input.inputFile,
    '-vf', scale,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-profile:v', 'main',
    '-pix_fmt', 'yuv420p',
    '-b:v', `${rendition.bitrateKbps}k`,
    '-maxrate', `${rendition.maxRateKbps}k`,
    '-bufsize', `${rendition.bufSizeKbps}k`,
    // Chave a cada 2x a duração do segmento mantém os cortes alinhados
    // sem inflar o número de segmentos.
    '-g', String(input.segmentSeconds * 2),
    '-keyint_min', String(input.segmentSeconds * 2),
    '-sc_threshold', '0',
    '-force_key_frames', `expr:gte(t,n_forced*${input.segmentSeconds})`,
  ];

  if (input.hasAudio) {
    args.push('-c:a', 'aac', '-b:a', `${rendition.audioKbps}k`, '-ac', '2');
  } else {
    args.push('-an');
  }

  args.push(
    '-f', 'hls',
    '-hls_time', String(input.segmentSeconds),
    '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', join(dir, 'seg-%05d.ts'),
    join(dir, 'index.m3u8'),
  );

  await run(args);

  const bandwidth = (rendition.bitrateKbps + rendition.audioKbps) * 1000;
  return {
    label: rendition.label,
    dir,
    bandwidth,
    attributes:
      `BANDWIDTH=${bandwidth},AVERAGE-BANDWIDTH=${rendition.bitrateKbps * 1000}` +
      `,RESOLUTION=${rendition.width}x${rendition.height}` +
      `,NAME="${rendition.label}",CODECS="avc1.4d401f,mp4a.40.2"`,
  };
}

/** Conteúdo do master playlist que aponta para cada variante. */
export function buildMasterPlaylist(renditions: TranscodeResult[]): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-INDEPENDENT-SEGMENTS'];

  for (const r of renditions) {
    lines.push(`#EXT-X-STREAM-INF:${r.attributes}`);
    lines.push(`${safeSegment(r.label)}/index.m3u8`);
  }

  return `${lines.join('\n')}\n`;
}

export async function uploadDir(
  s3: S3Config,
  prefix: string,
  dir: string,
): Promise<string[]> {
  const entries = await readdir(dir);
  const uploaded: string[] = [];

  for (const entry of entries) {
    const localPath = join(dir, entry);
    const info = await stat(localPath);
    if (!info.isFile()) continue;

    const key = `${prefix}/${entry}`;
    await s3.client.send(
      new PutObjectCommand({
        Bucket: s3.outputBucket,
        Key: key,
        Body: createReadStream(localPath),
        ContentLength: info.size,
        // Manifestos precisam ser revalidados; segmentos são imutáveis.
        CacheControl: entry.endsWith('.m3u8')
          ? 'public, max-age=60'
          : 'public, max-age=31536000, immutable',
        ContentType: entry.endsWith('.m3u8')
          ? 'application/vnd.apple.mpegurl'
          : 'video/mp2t',
      }),
    );
    uploaded.push(key);
  }

  return uploaded;
}

export async function putText(
  s3: S3Config,
  key: string,
  body: string,
  contentType: string,
): Promise<string> {
  await s3.client.send(
    new PutObjectCommand({
      Bucket: s3.outputBucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: Buffer.byteLength(body),
      CacheControl: 'public, max-age=60',
    }),
  );
  return key;
}

export async function writeLocal(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, 'utf8');
}

export async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
