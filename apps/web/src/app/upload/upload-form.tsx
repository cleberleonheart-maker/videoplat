'use client';

import { useCallback, useState } from 'react';
import { apiFetch } from '@/lib/api';

interface InitiateResponse {
  videoId: string;
  mode: 'multipart' | 'single';
  uploadId: string | null;
  objectKey: string;
  partSize: number;
  partsCount: number;
  parts: { partNumber: number; url: string }[];
}

export function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);

  /**
   * Upload paralelo dos chunks direto para o S3 via URLs pré-assinadas.
   * 4 conexões mantêm a banda saturada sem derrubar a sessão do browser.
   */
  const uploadParts = useCallback(
    async (file: File, session: InitiateResponse, token: string) => {
      const completed: { partNumber: number; etag: string }[] = [];
      let uploadedBytes = 0;

      const queue = [...session.parts];

      const worker = async () => {
        while (queue.length > 0) {
          const part = queue.shift()!;
          const start = (part.partNumber - 1) * session.partSize;
          const end = Math.min(start + session.partSize, file.size);
          const chunk = file.slice(start, end);

          const response = await fetch(part.url, {
            method: 'PUT',
            body: chunk,
          });

          if (!response.ok) {
            throw new Error(`Falha no chunk ${part.partNumber}`);
          }

          const etag = response.headers.get('ETag');
          if (!etag) {
            throw new Error('S3 não devolveu ETag; multipart inválido');
          }

          completed.push({ partNumber: part.partNumber, etag });
          uploadedBytes += chunk.size;
          setProgress(Math.round((uploadedBytes / file.size) * 100));
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(4, session.partsCount) }, worker),
      );

      return completed;
    },
    [],
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setVideoId(null);

    if (!file) {
      setError('Escolha um arquivo de vídeo');
      return;
    }

    const token = await getToken();
    if (!token) {
      setError('Você precisa estar logado para enviar vídeos');
      return;
    }

    try {
      setPhase('Preparando upload...');
      setProgress(0);

      const session = await apiFetch<InitiateResponse>('/api/uploads/initiate', {
        method: 'POST',
        token,
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || 'video/mp4',
          sizeBytes: file.size,
          title: title || file.name,
        }),
      });

      setVideoId(session.videoId);
      setPhase('Enviando arquivo...');

      const parts = await uploadParts(file, session, token);

      setPhase('Finalizando e agendando transcodificação...');

      await apiFetch('/api/uploads/complete', {
        method: 'POST',
        token,
        body: JSON.stringify({
          videoId: session.videoId,
          uploadId: session.uploadId,
          parts,
          title: title || file.name,
          description,
          tags: [],
          visibility: 'PUBLIC',
        }),
      });

      setPhase('Enviado! O vídeo será processado em segundo plano.');
      setProgress(100);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Falha no upload';
      setError(message);
      setPhase('');
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 560 }}>
      <label htmlFor="file">Arquivo de vídeo</label>
      <input
        id="file"
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        MP4, MOV ou WebM. Mínimo 64 MB, máximo 20 GB.
      </p>

      <label htmlFor="title">Título</label>
      <input
        id="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={140}
        placeholder="Um bom título faz diferença"
      />

      <label htmlFor="description">Descrição</label>
      <textarea
        id="description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={5}
        maxLength={5000}
      />

      {progress > 0 && (
        <div style={{ marginTop: 20 }}>
          <div
            style={{
              height: 6,
              borderRadius: 3,
              background: 'var(--border)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progress}%`,
                background: 'var(--accent)',
                transition: 'width 200ms',
              }}
            />
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            {phase} {progress}%
          </p>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {videoId && !error && (
        <p className="success">
          Vídeo criado. Acompanhe o processamento em /watch?v={videoId}
        </p>
      )}

      <div style={{ marginTop: 20 }}>
        <button type="submit" disabled={!file || progress > 0 && progress < 100}>
          Enviar vídeo
        </button>
      </div>
    </form>
  );
}

/**
 * Access token guardado em memória por sessão. Em produção viria de um
 * cookie httpOnly via middleware do Next — o browser não deve poder ler.
 */
async function getToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('accessToken');
}
