'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const path =
        mode === 'login' ? '/api/auth/login' : '/api/auth/register';

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(
          mode === 'login'
            ? { email, password }
            : { email, password, username, displayName },
        ),
      });

      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.message ?? 'Falha na autenticação');
      }

      // MVP: o access token fica em localStorage para o upload client-side.
      // Em produção, migrar para cookie httpOnly + refresh rotation.
      window.localStorage.setItem('accessToken', body.accessToken);

      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 400 }}>
      <h1>{mode === 'login' ? 'Entrar' : 'Criar conta'}</h1>

      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
      />

      <label htmlFor="password">Senha</label>
      <input
        id="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={8}
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
      />

      {mode === 'register' && (
        <>
          <label htmlFor="username">Nome de usuário</label>
          <input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            maxLength={24}
            pattern="[A-Za-z0-9_]+"
          />

          <label htmlFor="displayName">Nome de exibição</label>
          <input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            minLength={2}
            maxLength={60}
          />
        </>
      )}

      {error && <p className="error">{error}</p>}

      <div style={{ marginTop: 20, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button type="submit" disabled={loading}>
          {loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
        </button>

        <button
          type="button"
          className="secondary"
          onClick={() =>
            setMode(mode === 'login' ? 'register' : 'login')
          }
        >
          {mode === 'login' ? 'Criar conta' : 'Já tenho conta'}
        </button>
      </div>
    </form>
  );
}
