'use client';

import { useState } from 'react';
import { getToken } from '@/lib/session';
import { uploadVideoBlob } from '@/lib/upload';

export function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);

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
      setPhase('Enviando arquivo...');
      setProgress(0);

      const id = await uploadVideoBlob(
        file,
        file.name,
        file.type || 'video/mp4',
        { title: title || file.name, description, visibility: 'PUBLIC' },
        token,
        (percent) => setProgress(percent),
      );

      setVideoId(id);
      setPhase('Enviado! O vídeo será processado em segundo plano.');
      setProgress(100);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha no upload';
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
        <button
          type="submit"
          disabled={!file || (progress > 0 && progress < 100)}
        >
          Enviar vídeo
        </button>
      </div>
    </form>
  );
}
