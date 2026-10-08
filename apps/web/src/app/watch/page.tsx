import { apiFetch, PlaybackInfo, VideoCard, VideoDetail, formatViews } from '@/lib/api';
import { WatchPlayer } from '@/components/watch-player';
import { VideoGrid } from '@/components/video-grid';

// O token do cookie httpOnly muda a renderização server-side do player.
export const dynamic = 'force-dynamic';

export default async function WatchPage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>;
}) {
  const { v: videoId } = await searchParams;

  if (!videoId) {
    return <p className="muted">Parâmetro ?v= ausente.</p>;
  }

  let video: VideoDetail;
  let playback: PlaybackInfo;

  try {
    [video, playback] = await Promise.all([
      apiFetch<VideoDetail>(`/api/videos/${videoId}`),
      apiFetch<PlaybackInfo>(`/api/videos/${videoId}/playback`),
    ]);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Falha ao carregar o vídeo';
    return (
      <>
        <h1>Vídeo indisponível</h1>
        <p className="muted">{message}</p>
      </>
    );
  }

  const poster =
    video.thumbnailUrl ??
    video.thumbnails?.map((t) => t.objectKey).slice(0, 1)[0] ??
    null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 24 }}>
      <div>
        <WatchPlayer
          videoId={video.id}
          masterUrl={playback.masterUrl}
          poster={poster}
        />

        <h1 style={{ margin: '16px 0 8px' }}>{video.title}</h1>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            paddingBottom: 16,
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div>
            <p style={{ margin: 0, fontWeight: 600 }}>
              {video.channel.name}
            </p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
              {formatViews(video.stats?.views)}
            </p>
          </div>

          <button className="secondary" style={{ marginLeft: 'auto' }}>
            {video.subscribed ? 'Inscrito' : 'Inscrever-se'}
          </button>
        </div>

        {video.description && (
          <div
            style={{
              marginTop: 16,
              padding: 16,
              borderRadius: 12,
              background: 'var(--surface)',
              fontSize: 14,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
            }}
          >
            {video.description}
          </div>
        )}
      </div>

      <aside>
        <h2 style={{ marginTop: 0 }}>Próximos vídeos</h2>
        <UpcomingVideos currentId={video.id} />
      </aside>
    </div>
  );
}

async function UpcomingVideos({ currentId }: { currentId: string }) {
  try {
    const feed = await apiFetch<{ latest: VideoCard[] }>(
      '/api/feed?limit=12',
    );
    const others = feed.latest.filter((v) => v.id !== currentId).slice(0, 10);

    return <VideoGrid videos={others} emptyMessage="Nada a sugerir ainda." />;
  } catch {
    return <p className="muted">Não foi possível carregar as sugestões.</p>;
  }
}
