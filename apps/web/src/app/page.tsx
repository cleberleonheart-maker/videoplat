import { apiFetch, VideoCard } from '@/lib/api';
import { VideoGrid } from '@/components/video-grid';

// Sem cache: o feed muda a cada upload e a lista é personalized por usuário.
export const dynamic = 'force-dynamic';

interface FeedResponse {
  latest: VideoCard[];
  subscribed: VideoCard[];
}

export default async function HomePage() {
  let feed: FeedResponse = { latest: [], subscribed: [] };

  try {
    feed = await apiFetch<FeedResponse>('/api/feed?limit=24');
  } catch {
    // Feed vazio quando a API está fora: a home ainda renderiza.
  }

  const latest = feed.latest;

  return (
    <>
      <h1>Recomendados</h1>
      <VideoGrid
        videos={latest}
        emptyMessage="Nenhum vídeo publicado ainda. Faça o primeiro upload."
      />

      {feed.subscribed.length > 0 && (
        <>
          <h2>De canais que vocêAssina</h2>
          <VideoGrid videos={feed.subscribed} />
        </>
      )}
    </>
  );
}
