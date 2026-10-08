import { apiFetch, VideoCard } from '@/lib/api';
import { VideoGrid } from '@/components/video-grid';

export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;

  if (!q.trim()) {
    return (
      <>
        <h1>Buscar</h1>
        <p className="muted">Digite algo no campo acima.</p>
      </>
    );
  }

  let items: VideoCard[] = [];

  try {
    const result = await apiFetch<{ items: VideoCard[]; total: number }>(
      `/api/search?q=${encodeURIComponent(q)}&limit=24`,
    );
    items = result.items;
  } catch {
    return (
      <>
        <h1>Buscar</h1>
        <p className="muted">Não foi possível buscar agora. Tente novamente.</p>
      </>
    );
  }

  return (
    <>
      <h1>
        Resultados para <q>{q}</q>
      </h1>
      <p className="muted" style={{ fontSize: 14 }}>
        {items.length} resultado{items.length === 1 ? '' : 's'}
      </p>
      <VideoGrid videos={items} emptyMessage="Nenhum vídeo encontrado." />
    </>
  );
}
