'use client';

/**
 * Chat genérico com a plataforma Adaflow, em streaming.
 * O histórico é mantido no estado do componente; o `chatId` devolvido pela
 * plataforma (header x-chat-id) é reenviado a cada turno para continuar a
 * mesma conversa server-side.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { clearJwt, getJwt, markAuthOk, retryLoginOnce } from '@/lib/auth';
import { track } from '@/lib/tracking';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const chatIdRef = useRef<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!getJwt()) router.replace('/');
  }, [router]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;

    const jwt = getJwt();
    if (!jwt) {
      router.replace('/');
      return;
    }

    const history = [...messages, { role: 'user' as const, content: text }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setNotice(null);
    setSending(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          // Com chatId, a plataforma guarda o histórico — só a mensagem nova vai.
          messages: chatIdRef.current ? [{ role: 'user', content: text }] : history,
          chatId: chatIdRef.current,
        }),
      });

      if (res.status === 401) {
        setMessages(history);
        if (!retryLoginOnce()) {
          clearJwt();
          setNotice('Não foi possível renovar sua sessão — entre novamente.');
          router.replace('/');
        }
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setMessages(history);
        setNotice(body?.message ?? 'Não foi possível enviar a mensagem. Tente novamente.');
        return;
      }

      markAuthOk();
      chatIdRef.current = res.headers.get('x-chat-id') ?? chatIdRef.current;
      // Passo de negócio na trilha de auditoria (módulo Governança do Adaflow)
      track({
        action: 'app.chat.mensagem-enviada',
        resource: 'Chat',
        metadata: { chatId: chatIdRef.current },
      });

      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let assistant = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        assistant += decoder.decode(value, { stream: true });
        const snapshot = assistant;
        setMessages([...history, { role: 'assistant', content: snapshot }]);
      }
    } catch (err) {
      console.error('[chat] falha de rede', err);
      setMessages(history);
      setNotice('Falha de conexão — verifique sua rede e tente de novo.');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="flex h-[80vh] w-full max-w-2xl flex-col">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Chat — Adaflow</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              clearJwt();
              router.replace('/');
            }}
          >
            Sair
          </Button>
        </CardHeader>
        <CardContent className="min-h-0 flex-1">
          <ScrollArea className="h-full pr-4">
            {messages.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Envie uma mensagem para começar.
              </p>
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
            <div ref={scrollRef} />
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
              placeholder="Escreva sua mensagem…"
              disabled={sending}
            />
            <Button type="submit" disabled={sending || input.trim() === ''}>
              Enviar
            </Button>
          </form>
        </CardFooter>
      </Card>
    </main>
  );
}
