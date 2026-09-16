'use client';

/**
 * Callback do SSO handoff: o Adaflow devolve o JWT no fragment `#sso_token=`.
 * `session.completeLogin` extrai o token, salva e limpa o fragment do
 * histórico do browser (obrigatório — o token nunca pode ficar na URL).
 */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { session } from '@/lib/auth';

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const token = session.completeLogin();
    router.replace(token ? '/chat' : '/');
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">Entrando…</p>
    </main>
  );
}
