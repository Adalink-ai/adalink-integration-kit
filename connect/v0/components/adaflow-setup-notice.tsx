'use client';

/**
 * Aviso de configuração da Adaflow e o hook que consulta /api/adaflow/status.
 * O Open in v0 não leva variáveis de ambiente, então o bloco abre sem token:
 * em vez de um erro, a tela explica o que configurar.
 */
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export type AdaflowStatus = 'loading' | 'ready' | 'not_configured' | 'unreachable';

export function useAdaflowStatus(): AdaflowStatus {
  const [status, setStatus] = useState<AdaflowStatus>('loading');

  useEffect(() => {
    let active = true;
    fetch('/api/adaflow/status', { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<{ configured?: boolean }>) : Promise.reject(res.status)))
      .then((body) => {
        if (active) setStatus(body.configured ? 'ready' : 'not_configured');
      })
      .catch((err: unknown) => {
        console.error('[adaflow] status indisponível', err);
        if (active) setStatus('unreachable');
      });
    return () => {
      active = false;
    };
  }, []);

  return status;
}

export function AdaflowSetupNotice({ status }: { status: Exclude<AdaflowStatus, 'ready' | 'loading'> }) {
  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>
          {status === 'not_configured' ? 'Conecte este app à Adaflow' : 'Não foi possível verificar a Adaflow'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        {status === 'not_configured' ? (
          <>
            <p>
              Adicione a variável <code className="font-mono">ADAFLOW_APP_TOKEN</code> nas variáveis do projeto, com o
              token de app criado na Adaflow (começa com <code className="font-mono">ada_</code>).
            </p>
            <p>
              Não use o prefixo <code className="font-mono">NEXT_PUBLIC_</code>: o token só pode ser lido no servidor.
            </p>
          </>
        ) : (
          <p>A rota /api/adaflow/status não respondeu. Recarregue a página em instantes.</p>
        )}
      </CardContent>
    </Card>
  );
}
