'use client';

import { useEffect, useState } from 'react';
import { apiFetch, formatViews, VideoDetail } from '@/lib/api';
import { getToken } from '@/lib/session';

type Reaction = 'LIKE' | 'DISLIKE' | null;

function contribution(reaction: Reaction): number {
  if (reaction === 'LIKE') return 1;
  if (reaction === 'DISLIKE') return -1;
  return 0;
}

function formatCount(value: number): string {
  const n = Math.max(0, value);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')} mi`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace('.0', '')} mil`;
  return String(n);
}

/**
 * Inscrever-se + curtir/descurtir. O SSR não enxerga o token do localStorage,
 * então revalidamos o estado real do usuário assim que monta no navegador.
 */
export function VideoInteractions({
  videoId,
  handle,
  initialSubscribed,
  initialReaction,
  initialLikes,
  initialViews,
}: {
  videoId: string;
  handle: string;
  initialSubscribed: boolean;
  initialReaction: Reaction;
  initialLikes: number;
  initialViews: number;
}) {
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [reaction, setReaction] = useState<Reaction>(initialReaction);
  const [likes, setLikes] = useState(initialLikes);
  const [views, setViews] = useState(initialViews);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) return;
    let active = true;
    apiFetch<VideoDetail>(`/api/videos/${videoId}`, { token: getToken() })
      .then((fresh) => {
        if (!active) return;
        setSubscribed(fresh.subscribed);
        setReaction(fresh.viewerReaction ?? null);
        setLikes(fresh.stats?.likes ?? initialLikes);
        setViews(fresh.stats?.views ?? initialViews);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  const requireLogin = () => {
    window.location.href = `/login?next=${encodeURIComponent(
      `/watch?v=${videoId}`,
    )}`;
  };

  const toggleSubscribe = async () => {
    const token = getToken();
    if (!token) return requireLogin();
    setBusy(true);
    setNotice(null);
    try {
      const next = !subscribed;
      const res = await apiFetch<{ subscribed: boolean }>(
        `/api/subscriptions/${encodeURIComponent(handle)}`,
        { method: next ? 'POST' : 'DELETE', token },
      );
      setSubscribed(res.subscribed);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Falha ao inscrever');
    } finally {
      setBusy(false);
    }
  };

  const react = async (type: 'LIKE' | 'DISLIKE') => {
    const token = getToken();
    if (!token) return requireLogin();
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiFetch<{ reaction: Reaction }>(
        `/api/videos/${videoId}/comments/reaction`,
        { method: 'POST', token, body: JSON.stringify({ type }) },
      );
      const next = res.reaction ?? null;
      setLikes((prev) => prev - contribution(reaction) + contribution(next));
      setReaction(next);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Falha ao reagir');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      <button
        onClick={toggleSubscribe}
        disabled={busy}
        className={subscribed ? 'secondary' : undefined}
      >
        {subscribed ? 'Inscrito' : 'Inscrever-se'}
      </button>

      <div
        style={{
          display: 'flex',
          border: '1px solid var(--border)',
          borderRadius: 999,
          overflow: 'hidden',
          background: 'var(--surface)',
        }}
      >
        <button
          onClick={() => react('LIKE')}
          disabled={busy}
          aria-pressed={reaction === 'LIKE'}
          title="Curtir"
          style={{
            borderRadius: 0,
            background: reaction === 'LIKE' ? 'var(--accent)' : 'transparent',
            color: reaction === 'LIKE' ? '#0f0f0f' : 'var(--text)',
            border: 'none',
            padding: '10px 16px',
          }}
        >
          ▲ {formatCount(likes)}
        </button>
        <button
          onClick={() => react('DISLIKE')}
          disabled={busy}
          aria-pressed={reaction === 'DISLIKE'}
          title="Não gostei"
          style={{
            borderRadius: 0,
            background:
              reaction === 'DISLIKE' ? 'var(--accent)' : 'transparent',
            color: reaction === 'DISLIKE' ? '#0f0f0f' : 'var(--text)',
            border: 'none',
            borderLeft: '1px solid var(--border)',
            padding: '10px 16px',
          }}
        >
          ▼
        </button>
      </div>

      <span className="muted" style={{ fontSize: 13 }}>
        {formatViews(views)}
      </span>

      {notice && <span className="error">{notice}</span>}
    </div>
  );
}
