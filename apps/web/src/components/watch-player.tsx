'use client';

import { useCallback, useRef } from 'react';
import { VideoPlayer } from './video-player';
import { apiFetch } from '@/lib/api';

export function WatchPlayer({
  videoId,
  masterUrl,
  poster,
  token,
}: {
  videoId: string;
  masterUrl: string;
  poster?: string | null;
  token?: string;
}) {
  const viewSent = useRef(false);

  const handleFirstPlay = useCallback(() => {
    // Uma visualização por sessão de playback, não a cada play/pause.
    if (viewSent.current) return;
    viewSent.current = true;
    apiFetch(`/api/videos/${videoId}/views`, {
      method: 'POST',
      token,
    }).catch(() => {
      // Falha de métrica não pode interromper a reprodução.
    });
  }, [videoId, token]);

  return (
    <VideoPlayer
      src={masterUrl}
      poster={poster}
      onFirstPlay={handleFirstPlay}
    />
  );
}
