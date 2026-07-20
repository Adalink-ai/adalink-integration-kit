'use client';

/**
 * Callback do SSO handoff: o Adaflow devolve o JWT no fragment `#sso_token=`.
 * `consumeSsoToken` extrai o token e limpa o fragment do histórico do browser
 * (obrigatório — o token nunca pode ficar na URL).
 */
import { consumeSsoToken } from '@adaflow/sdk';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { saveJwt } from '@/lib/auth';

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const token = consumeSsoToken();
    if (token) {
      saveJwt(token);
      router.replace('/chat');
    } else {
      router.replace('/');
    }
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">Entrando…</p>
    </main>
  );
}
