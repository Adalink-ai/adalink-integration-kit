import { AdaflowChat } from '@/components/adaflow-chat';

/**
 * Exemplo do bloco adaflow-chat. Para conversar com um especialista, troque
 * `model` por specialistId="<uuid do especialista>" (o MCP da Adaflow lista os
 * especialistas da organização).
 */
export default function AdaflowChatPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <AdaflowChat model="anthropic/claude-haiku-4.5" title="Assistente Adaflow" />
    </main>
  );
}
