import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'VideoPlat',
  description: 'Plataforma de vídeo open-source',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            padding: '12px 24px',
            background: 'var(--bg)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Link
            href="/"
            style={{
              fontSize: 20,
              fontWeight: 700,
              textDecoration: 'none',
              letterSpacing: '-0.5px',
            }}
          >
            Video<span style={{ color: 'var(--accent)' }}>Plat</span>
          </Link>

          <form action="/search" style={{ flex: 1, maxWidth: 480 }}>
            <input
              type="search"
              name="q"
              placeholder="Buscar vídeos"
              aria-label="Buscar vídeos"
            />
          </form>

          <nav style={{ display: 'flex', gap: 16, marginLeft: 'auto' }}>
            <Link href="/camera" style={{ fontSize: 14 }}>
              Câmera
            </Link>
            <Link href="/upload" style={{ fontSize: 14 }}>
              Enviar
            </Link>
            <Link href="/login" style={{ fontSize: 14 }}>
              Entrar
            </Link>
          </nav>
        </header>

        <main>{children}</main>
      </body>
    </html>
  );
}
