'use client';

/**
 * Executa um agente autônomo da Adaflow e mostra o resultado.
 *
 * <AdaflowAgentRunner agentId="<uuid do agente>" />
 *
 * Fala só com /api/adaflow/agents/:agentId/run, no servidor do próprio app.
 * O `threadId` devolvido é reenviado nas próximas execuções para o agente
 * manter o contexto.
 */
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { AdaflowSetupNotice, useAdaflowStatus } from '@/components/adaflow-setup-notice';

export interface AdaflowAgentRunnerProps {
  /** UUID do agente autônomo da Adaflow. */
  agentId: string;
  title?: string;
  placeholder?: string;
}

/** Sucesso: `error` é texto quando o agente falhou. Falha da rota: `error` é `{ code, message }`. */
interface RunResponse {
  status?: string;
  output?: string;
  threadId?: string;
  error?: string | { code?: string; message?: string };
}

export function AdaflowAgentRunner({
  agentId,
  title = 'Agente',
  placeholder = 'Descreva a tarefa para o agente…',
}: AdaflowAgentRunnerProps) {
  const status = useAdaflowStatus();
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const threadIdRef = useRef<string | undefined>(undefined);

  if (status === 'not_configured' || status === 'unreachable') return <AdaflowSetupNotice status={status} />;

  async function run() {
    const text = input.trim();
    if (!text || running) return;
    setRunning(true);
    setNotice(null);
    setOutput(null);

    try {
      const res = await fetch(`/api/adaflow/agents/${encodeURIComponent(agentId)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: text, threadId: threadIdRef.current }),
      });
      const body = (await res.json().catch(() => null)) as RunResponse | null;

      if (!res.ok) {
        const message = typeof body?.error === 'object' ? body.error?.message : undefined;
        setNotice(message ?? 'Não foi possível executar o agente. Tente de novo.');
        return;
      }

      threadIdRef.current = body?.threadId ?? threadIdRef.current;
      if (body?.status === 'failed') {
        setNotice(typeof body.error === 'string' ? body.error : 'O agente não conseguiu concluir a tarefa.');
        return;
      }
      setOutput(body?.output ?? '');
    } catch (err) {
      console.error('[adaflow] agente: falha de rede', err);
      setNotice('Falha de conexão. Verifique a rede e tente de novo.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          className="min-h-28 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={placeholder}
          disabled={running || status === 'loading'}
        />
        {running && <p className="text-sm text-muted-foreground">Executando. Agentes podem levar alguns minutos.</p>}
        {output !== null && (
          <div className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">
            {output || 'O agente terminou sem texto de saída.'}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2">
        {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
        <Button onClick={() => void run()} disabled={running || status === 'loading' || input.trim() === ''}>
          {running ? 'Executando…' : 'Executar'}
        </Button>
      </CardFooter>
    </Card>
  );
}
