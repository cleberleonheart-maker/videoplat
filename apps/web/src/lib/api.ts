export const API_URL =
  process.env.API_URL_INTERNAL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export const MEDIA_URL =
  process.env.NEXT_PUBLIC_MEDIA_URL ?? 'http://localhost:9000/videoplat';

export interface VideoCard {
  id: string;
  title: string;
  durationSec: number | null;
  thumbnailUrl: string | null;
  views?: number;
  likes?: number;
  publishedAt?: string | null;
  channel: { id?: string; handle: string; name: string };
  stats?: { views: number; likes: number };
  thumbnails?: { label: string; objectKey: string }[];
}

export interface PlaybackSource {
  label: string;
  width: number;
  height: number;
  bitrateKbps: number;
  url: string;
}

export interface PlaybackInfo {
  videoId: string;
  title: string;
  durationSec: number | null;
  /** Master playlist HLS: entrada do ABR. */
  masterUrl: string;
  sources: PlaybackSource[];
}

export interface VideoDetail extends VideoCard {
  description: string | null;
  tags: string[];
  viewerReaction: 'LIKE' | 'DISLIKE' | null;
  subscribed: boolean;
  stats: { views: number; likes: number; dislikes?: number; comments: number };
}

/**
 * O token vive em cookie httpOnly e é repassado no header. Nunca em
 * localStorage: qualquer XSS passa a ter acesso direto ao token.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = init;

  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Request failed with ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export function mediaUrl(key: string): string {
  return `${MEDIA_URL}/${key}`;
}

export function formatDuration(seconds: number | null): string {
  if (!seconds && seconds !== 0) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatViews(count: number | undefined): string {
  if (!count) return '0 visualizações';
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace('.0', '')} mi de visualizações`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace('.0', '')} mil visualizações`;
  }
  return `${count} visualizações`;
}
