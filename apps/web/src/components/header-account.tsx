'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  currentUsername,
  notifyAuthChanged,
  getToken,
} from '@/lib/session';

/**
 * Cabeçalho com o estado de sessão. O layout é um server component e não
 * enxerga o token do localStorage, então este componente client lê a sessão
 * no mount e a mantém sincronizada via o evento `vp-auth` (disparado no
 * login/logout) e o evento `storage` (outras abas).
 */
export function HeaderAccount() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [logged, setLogged] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => {
      setLogged(Boolean(getToken()));
      setUsername(currentUsername());
    };
    sync();
    setReady(true);
    window.addEventListener('vp-auth', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('vp-auth', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  if (!ready) {
    return <span style={{ fontSize: 14, opacity: 0 }}>Entrar</span>;
  }

  if (!logged) {
    return (
      <Link href="/login" style={{ fontSize: 14 }}>
        Entrar
      </Link>
    );
  }

  const logout = () => {
    try {
      window.localStorage.removeItem('accessToken');
    } catch {
      /* ignore */
    }
    notifyAuthChanged();
    router.push('/');
    router.refresh();
  };

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 14, opacity: 0.85 }}>
        {username ? `@${username}` : 'Conta'}
      </span>
      <button
        type="button"
        onClick={logout}
        style={{
          fontSize: 13,
          padding: '4px 10px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
        }}
      >
        Sair
      </button>
    </span>
  );
}
