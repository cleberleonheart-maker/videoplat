import { Suspense } from 'react';
import { LoginForm } from './login-form';

export const metadata = { title: 'Entrar — VideoPlat' };

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="muted">Carregando…</p>}>
      <LoginForm />
    </Suspense>
  );
}
