'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getJwt, startLogin } from '@/lib/auth';

const noopSubscribe = () => () => {};

export default function HomePage() {
  const router = useRouter();
  // Lê o JWT sem setState em effect (e sem mismatch de hidratação).
  const jwt = useSyncExternalStore(noopSubscribe, getJwt, () => null);

  useEffect(() => {
    if (jwt) router.replace('/chat');
  }, [jwt, router]);

  if (jwt) return null;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Adaflow Starter</CardTitle>
          <CardDescription>
            App integrado à plataforma Adaflow — entre com sua conta para
            conversar com a IA.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={startLogin}>
            Entrar com Adaflow
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
