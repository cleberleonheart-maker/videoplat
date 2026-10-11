/**
 * Sessão do usuário no browser. O token é guardado em localStorage (MVP).
 * Migrar para cookie httpOnly é um passo futuro; por enquanto centralizamos
 * aqui para não espalhar `localStorage.getItem('accessToken')` pelo código.
 */

export function getToken(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage.getItem('accessToken') ?? undefined;
  } catch {
    return undefined;
  }
}

function decodePayload(): Record<string, unknown> | null {
  const token = getToken();
  if (!token) return null;
  try {
    return JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    );
  } catch {
    return null;
  }
}

/** Extrai o `sub` (id do usuário) do JWT sem validar assinatura. */
export function currentUserId(): string | null {
  const payload = decodePayload();
  return payload && typeof payload.sub === 'string' ? payload.sub : null;
}

/** Extrai o `username` do JWT (para exibir no cabeçalho). */
export function currentUsername(): string | null {
  const payload = decodePayload();
  return payload && typeof payload.username === 'string'
    ? payload.username
    : null;
}

/** Notifica os componentes de UI que a sessão mudou (login/logout). */
export function notifyAuthChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('vp-auth'));
}
