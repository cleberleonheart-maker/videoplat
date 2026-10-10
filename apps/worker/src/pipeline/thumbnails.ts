import { mkdir } from 'fs/promises';
import { join } from 'path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { run, S3Config } from './ffmpeg';
import { THUMBNAIL_SPECS } from './renditions';

export interface ThumbnailResult {
  label: string;
  objectKey: string;
  width: number;
  height: number;
}

/**
 * Gera três thumbnails em tempos espaçados do vídeo e faz upload de cada uma
 * como JPEG individual. Frames são extraídos com -ss antes de -i para o
 * FFmpeg pular direto ao keyframe mais próximo, sem decodificar o início.
 *
 * Se coverTimeSec for informado, a primeira amostra (a capa de verdade)
 * passa a ser exatamente esse frame.
 */
export async function generateThumbnails(
  inputFile: string,
  outputDir: string,
  durationSec: number,
  s3: S3Config,
  prefix: string,
  coverTimeSec?: number,
): Promise<ThumbnailResult[]> {
  const times = pickSampleTimes(durationSec);
  if (coverTimeSec != null && Number.isFinite(coverTimeSec)) {
    times[0] = clamp(coverTimeSec, 0, Math.max(0, durationSec));
  }
  const results: ThumbnailResult[] = [];

  for (const spec of THUMBNAIL_SPECS) {
    const dir = join(outputDir, `thumb-${spec.label}`);
    await mkdir(dir, { recursive: true });

    const paths: string[] = [];
    for (const [index, seconds] of times.entries()) {
      const out = join(dir, `frame-${index}.jpg`);
      await run([
        '-y',
        '-ss', String(seconds),
        '-i', inputFile,
        '-frames:v', '1',
        // -2 mantém o aspect e garante largura par.
        '-vf', `scale=${spec.width}:-2`,
        '-q:v', '3',
        out,
      ]);
      paths.push(out);
    }

    // A primeira amostra vira a thumbnail principal do vídeo.
    const objectKey = `${prefix}/thumbs/${spec.label}.jpg`;
    const { size } = await statAsync(paths[0]);
    const { createReadStream } = await import('fs');

    await s3.client.send(
      new PutObjectCommand({
        Bucket: s3.outputBucket,
        Key: objectKey,
        Body: createReadStream(paths[0]),
        ContentLength: size,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    results.push({
      label: spec.label,
      objectKey,
      width: spec.width,
      height: spec.height,
    });
  }

  return results;
}

async function statAsync(path: string) {
  const { stat } = await import('fs/promises');
  return stat(path);
}

function pickSampleTimes(durationSec: number): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [0];

  const count = 3;
  // Evita o primeiro frame (costuma estar preto) e fica longe do final,
  // onde muitos vídeos ainda não têm imagem válida.
  return Array.from({ length: count }, (_, i) => {
    const ratio = (i + 1) / (count + 1);
    return Number((durationSec * ratio).toFixed(2));
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
