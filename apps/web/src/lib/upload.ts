import { apiFetch } from './api';

export interface UploadSession {
  videoId: string;
  mode: 'multipart' | 'single';
  uploadId: string | null;
  objectKey: string;
  partSize: number;
  partsCount: number;
  parts: { partNumber: number; url: string }[];
}

export interface UploadMeta {
  title: string;
  description?: string;
  visibility?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
  trimStartSec?: number;
  trimEndSec?: number;
  thumbnailTimeSec?: number;
}

/**
 * Fluxo comum de upload do VideoPlat: inicia a sessão, envia as partes direto
 * ao S3 (até 4 em paralelo) e finaliza enfileirando a transcodificação.
 * Reutilizado pelo formulário de upload e pela câmera.
 */
export async function uploadVideoBlob(
  blob: Blob,
  fileName: string,
  contentType: string,
  meta: UploadMeta,
  token: string,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const session = await apiFetch<UploadSession>('/api/uploads/initiate', {
    method: 'POST',
    token,
    body: JSON.stringify({
      fileName,
      contentType,
      sizeBytes: blob.size,
      title: meta.title,
    }),
  });

  const completed: { partNumber: number; etag: string }[] = [];
  const queue = [...session.parts];
  const workers = Math.max(1, Math.min(4, session.partsCount || 1));
  let uploaded = 0;

  const worker = async () => {
    while (queue.length > 0) {
      const part = queue.shift()!;
      const start = (part.partNumber - 1) * session.partSize;
      const end = Math.min(start + session.partSize, blob.size);
      const chunk = blob.slice(start, end);

      const response = await fetch(part.url, { method: 'PUT', body: chunk });
      if (!response.ok) {
        throw new Error(`Falha ao enviar a parte ${part.partNumber}`);
      }
      const etag = response.headers.get('ETag');
      if (!etag) throw new Error('O storage não devolveu ETag');

      completed.push({ partNumber: part.partNumber, etag });
      uploaded += chunk.size;
      onProgress?.(Math.round((uploaded / blob.size) * 100));
    }
  };

  await Promise.all(Array.from({ length: workers }, worker));

  await apiFetch('/api/uploads/complete', {
    method: 'POST',
    token,
    body: JSON.stringify({
      videoId: session.videoId,
      uploadId: session.uploadId,
      parts: completed,
      title: meta.title,
      description: meta.description ?? '',
      tags: [],
      visibility: meta.visibility ?? 'PUBLIC',
      ...(meta.trimStartSec != null ? { trimStartSec: meta.trimStartSec } : {}),
      ...(meta.trimEndSec != null ? { trimEndSec: meta.trimEndSec } : {}),
      ...(meta.thumbnailTimeSec != null
        ? { thumbnailTimeSec: meta.thumbnailTimeSec }
        : {}),
    }),
  });

  return session.videoId;
}

/** Extensão de arquivo coerente com o content-type do vídeo. */
export function extensionForContentType(contentType: string): string {
  const type = contentType.split(';')[0].trim();
  if (type.includes('quicktime')) return 'mov';
  if (type.includes('webm')) return 'webm';
  return 'mp4';
}
