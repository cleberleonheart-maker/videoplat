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

/** Extrai o `sub` (id do usuário) do JWT sem validar assinatura. */
export function currentUserId(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    );
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
