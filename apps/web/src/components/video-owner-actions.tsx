'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

function currentUserId(): string | null {
  if (typeof window === 'undefined') return null;
  const token = window.localStorage.getItem('accessToken');
  if (!token) return null;
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    );
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export function VideoOwnerActions({
  videoId,
  uploaderId,
}: {
  videoId: string;
  uploaderId?: string;
}) {
  const router = useRouter();
  const [isOwner, setIsOwner] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setIsOwner(Boolean(uploaderId) && currentUserId() === uploaderId);
  }, [uploaderId]);

  if (!isOwner) return null;

  const handleDelete = async () => {
    if (!window.confirm('Excluir este vídeo? Essa ação não pode ser desfeita.')) {
      return;
    }
    const token = window.localStorage.getItem('accessToken') ?? undefined;
    setDeleting(true);
    try {
      await apiFetch(`/api/videos/${videoId}`, { method: 'DELETE', token });
      router.push('/');
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao excluir');
      setDeleting(false);
    }
  };

  return (
    <button className="secondary" onClick={handleDelete} disabled={deleting}>
      {deleting ? 'Excluindo...' : 'Excluir vídeo'}
    </button>
  );
}
