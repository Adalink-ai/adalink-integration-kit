'use client';

/**
 * Chat com um especialista ou modelo da Adaflow, com a resposta aparecendo
 * enquanto é gerada.
 *
 * <AdaflowChat specialistId="<uuid do especialista>" />
 * <AdaflowChat model="anthropic/claude-haiku-4.5" />
 *
 * Fala só com /api/adaflow/chat, no servidor do próprio app. O token da
 * Adaflow nunca chega ao navegador.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AdaflowSetupNotice, useAdaflowStatus } from '@/components/adaflow-setup-notice';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface AdaflowChatProps {
  /** UUID do especialista da Adaflow. Tem prioridade sobre `model`. */
  specialistId?: string;
  /** Modelo do catálogo da Adaflow, quando não houver especialista. */
  model?: string;
  title?: string;
  placeholder?: string;
}

export function AdaflowChat({
  specialistId,
  model,
  title = 'Assistente',
  placeholder = 'Escreva sua mensagem…',
}: AdaflowChatProps) {
  const status = useAdaflowStatus();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const chatIdRef = useRef<string | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (status === 'not_configured' || status === 'unreachable') return <AdaflowSetupNotice status={status} />;

  async function send() {
    const text = input.trim();
    if (!text || sending) return;

    const history: Message[] = [...messages, { role: 'user', content: text }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setNotice(null);
    setSending(true);

    try {
      const res = await fetch('/api/adaflow/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          specialistId,
          model,
          chatId: chatIdRef.current,
          // Com chatId, a Adaflow guarda o histórico: só a mensagem nova vai.
          messages: chatIdRef.current ? [{ role: 'user', content: text }] : history,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setMessages(history);
        setNotice(body?.error?.message ?? 'Não foi possível enviar a mensagem. Tente de novo.');
        return;
      }

      chatIdRef.current = res.headers.get('x-chat-id') ?? chatIdRef.current;
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let answer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        const snapshot = answer;
        setMessages([...history, { role: 'assistant', content: snapshot }]);
      }
    } catch (err) {
      console.error('[adaflow] chat: falha de rede', err);
      setMessages(history);
      setNotice('Falha de conexão. Verifique a rede e tente de novo.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="flex h-[70vh] w-full max-w-2xl flex-col">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        <ScrollArea className="h-full pr-4">
          {messages.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">Envie uma mensagem para começar.</p>
          )}
          <div className="flex flex-col gap-3">
            {messages.map((message, index) => (
              <div
                key={index}
                className={
                  message.role === 'user'
                    ? 'ml-auto max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground'
                    : 'mr-auto max-w-[80%] whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm'
                }
              >
                {message.content || (sending && index === messages.length - 1 ? '…' : '')}
              </div>
            ))}
          </div>
          <div ref={endRef} />
        </ScrollArea>
      </CardContent>
      <CardFooter className="flex-col gap-2">
        {notice && <p className="w-full text-sm text-muted-foreground">{notice}</p>}
        <form
          className="flex w-full gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={placeholder}
            disabled={sending || status === 'loading'}
          />
          <Button type="submit" disabled={sending || status === 'loading' || input.trim() === ''}>
            Enviar
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}
