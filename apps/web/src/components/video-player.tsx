'use client';

import Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState } from 'react';

interface VideoPlayerProps {
  /** Master playlist HLS — a entrada do ABR. */
  src: string;
  poster?: string | null;
  autoPlay?: boolean;
  /** Retoma a reprodução a partir deste offset (histórico). */
  startAt?: number;
  /** Disparado uma vez por sessão de reprodução. */
  onFirstPlay?: () => void;
}

export function VideoPlayer({
  src,
  poster,
  autoPlay = false,
  startAt,
  onFirstPlay,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const firedView = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const primary = src;

    const applyStartPosition = () => {
      if (startAt && startAt > 1 && video.duration > startAt + 5) {
        video.currentTime = startAt;
      }
    };

    // Safari toca HLS nativamente; hls.js duplicaria o buffer.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = primary;
      video.addEventListener('loadedmetadata', applyStartPosition);
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });

      hls.loadSource(primary);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, applyStartPosition);

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          setError('Falha ao carregar o vídeo');
          hls.destroy();
        }
      });

      return () => {
        video.removeEventListener('loadedmetadata', applyStartPosition);
        hls.destroy();
      };
    } else {
      setError('Seu navegador não suporta reprodução HLS');
      return;
    }

    return () => video.removeEventListener('loadedmetadata', applyStartPosition);
  }, [src, startAt]);

  const handlePlay = useCallback(() => {
    if (firedView.current) return;
    firedView.current = true;
    onFirstPlay?.();
  }, [onFirstPlay]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 9',
        background: '#000',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <video
        ref={videoRef}
        controls
        autoPlay={autoPlay}
        playsInline
        poster={poster ?? undefined}
        onPlay={handlePlay}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
      {error && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            background: 'rgba(0,0,0,0.7)',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
