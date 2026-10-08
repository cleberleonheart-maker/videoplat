import Link from 'next/link';
import { formatDuration, formatViews, VideoCard } from '@/lib/api';

export function VideoGrid({
  videos,
  emptyMessage = 'Nenhum vídeo por aqui ainda.',
}: {
  videos: VideoCard[];
  emptyMessage?: string;
}) {
  if (videos.length === 0) {
    return (
      <p style={{ color: '#888', padding: '24px 0' }}>{emptyMessage}</p>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 24,
      }}
    >
      {videos.map((video) => (
        <VideoCardItem key={video.id} video={video} />
      ))}
    </div>
  );
}

function VideoCardItem({ video }: { video: VideoCard }) {
  const views = video.views ?? video.stats?.views;

  return (
    <Link
      href={`/watch?v=${video.id}`}
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <div
        style={{
          position: 'relative',
          aspectRatio: '16 / 9',
          background: '#1f1f1f',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {video.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={video.thumbnailUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : null}

        {video.durationSec ? (
          <span
            style={{
              position: 'absolute',
              right: 8,
              bottom: 8,
              padding: '2px 6px',
              borderRadius: 4,
              background: 'rgba(0,0,0,0.8)',
              color: '#fff',
              fontSize: 12,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatDuration(video.durationSec)}
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: '#333',
            flexShrink: 0,
          }}
        />
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              lineHeight: 1.35,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {video.title}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#aaa' }}>
            {video.channel.name}
          </p>
          {views !== undefined && (
            <p style={{ margin: 0, fontSize: 13, color: '#aaa' }}>
              {formatViews(views)}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
