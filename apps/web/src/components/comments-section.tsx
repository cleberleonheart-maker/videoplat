'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { currentUserId, getToken } from '@/lib/session';

interface CommentAuthor {
  id: string;
  username: string;
  displayName: string | null;
}

interface CommentReply {
  id: string;
  body: string;
  createdAt: string;
  author: CommentAuthor;
}

interface CommentItem {
  id: string;
  body: string;
  createdAt: string;
  author: CommentAuthor;
  avatarUrl: string | null;
  replies: CommentReply[];
  _count: { replies: number };
}

function authorName(author: CommentAuthor): string {
  return author.displayName?.trim() || author.username;
}

function initials(author: CommentAuthor): string {
  return authorName(author).slice(0, 1).toUpperCase();
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Math.max(0, Date.now() - then) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
  if (diff < 2_592_000) return `${Math.floor(diff / 86400)} d`;
  if (diff < 31_536_000) return `${Math.floor(diff / 2_592_000)} mes`;
  return `${Math.floor(diff / 31_536_000)} a`;
}

export function CommentsSection({ videoId }: { videoId: string }) {
  const [items, setItems] = useState<CommentItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [me, setMe] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string) => {
      setError(null);
      try {
        const data = await apiFetch<{
          items: CommentItem[];
          nextCursor: string | null;
        }>(
          `/api/videos/${videoId}/comments?limit=20${
            cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
          }`,
        );
        setItems((prev) => (cursor ? [...prev, ...data.items] : data.items));
        setNextCursor(data.nextCursor);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Falha ao carregar comentários',
        );
      }
    },
    [videoId],
  );

  useEffect(() => {
    setMe(currentUserId());
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = getToken();
    if (!token) {
      window.location.href = `/login?next=${encodeURIComponent(
        `/watch?v=${videoId}`,
      )}`;
      return;
    }
    if (!text.trim()) return;
    setPosting(true);
    setError(null);
    try {
      const created = await apiFetch<Omit<CommentItem, 'replies' | '_count'>>(
        `/api/videos/${videoId}/comments`,
        { method: 'POST', token, body: JSON.stringify({ body: text.trim() }) },
      );
      setItems((prev) => [
        { ...created, replies: [], _count: { replies: 0 } },
        ...prev,
      ]);
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao comentar');
    } finally {
      setPosting(false);
    }
  };

  const remove = async (id: string) => {
    const token = getToken();
    if (!token) return;
    if (!window.confirm('Excluir este comentário?')) return;
    try {
      await apiFetch(`/api/videos/${videoId}/comments/${id}`, {
        method: 'DELETE',
        token,
      });
      setItems((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao excluir');
    }
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    await load(nextCursor);
    setLoadingMore(false);
  };

  return (
    <section style={{ marginTop: 24 }}>
      <h2 style={{ marginTop: 0 }}>
        Comentários{' '}
        <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>
          {items.length > 0 ? items.length : ''}
        </span>
      </h2>

      <form onSubmit={submit} style={{ marginBottom: 16 }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escreva um comentário..."
          rows={2}
          maxLength={10_000}
          aria-label="Escreva um comentário"
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="submit" disabled={posting || !text.trim()}>
            {posting ? 'Enviando...' : 'Comentar'}
          </button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="muted">Carregando comentários…</p>
      ) : items.length === 0 ? (
        <p className="muted">Nenhum comentário ainda. Seja o primeiro!</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((comment) => (
            <li
              key={comment.id}
              style={{
                display: 'flex',
                gap: 12,
                padding: '12px 0',
                borderTop: '1px solid var(--border)',
              }}
            >
              <Avatar author={comment.author} avatarUrl={comment.avatarUrl} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, marginBottom: 4 }}>
                  <strong>{authorName(comment.author)}</strong>{' '}
                  <span className="muted">
                    {relativeTime(comment.createdAt)}
                  </span>
                </div>
                <p
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    fontSize: 14,
                    lineHeight: 1.5,
                  }}
                >
                  {comment.body}
                </p>

                {comment.replies?.length > 0 && (
                  <ul
                    style={{
                      listStyle: 'none',
                      padding: '8px 0 0',
                      margin: '8px 0 0',
                      borderLeft: '2px solid var(--border)',
                      paddingLeft: 12,
                    }}
                  >
                    {comment.replies.map((reply) => (
                      <li key={reply.id} style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 12, marginBottom: 2 }}>
                          <strong>{authorName(reply.author)}</strong>{' '}
                          <span className="muted">
                            {relativeTime(reply.createdAt)}
                          </span>
                        </div>
                        <p
                          style={{
                            margin: 0,
                            whiteSpace: 'pre-wrap',
                            overflowWrap: 'anywhere',
                            fontSize: 13,
                          }}
                        >
                          {reply.body}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}

                {me === comment.author.id && (
                  <button
                    className="secondary"
                    onClick={() => remove(comment.id)}
                    style={{ marginTop: 8, padding: '4px 10px', fontSize: 12 }}
                  >
                    Excluir
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <div style={{ marginTop: 12 }}>
          <button
            className="secondary"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? 'Carregando...' : 'Ver mais comentários'}
          </button>
        </div>
      )}
    </section>
  );
}

function Avatar({
  author,
  avatarUrl,
}: {
  author: CommentAuthor;
  avatarUrl: string | null;
}) {
  const style: React.CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: '50%',
    flex: '0 0 auto',
    objectFit: 'cover',
    background: 'var(--accent)',
    color: '#0f0f0f',
    display: 'grid',
    placeItems: 'center',
    fontWeight: 700,
    fontSize: 16,
  };
  if (avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatarUrl} alt="" style={style} />;
  }
  return <div style={style}>{initials(author)}</div>;
}
