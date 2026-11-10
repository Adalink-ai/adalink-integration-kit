import { AdaflowAgentRunner } from '@/components/adaflow-agent-runner';

/**
 * Exemplo do bloco adaflow-agent-runner. Troque AGENT_ID pelo UUID do agente
 * autônomo (o MCP da Adaflow lista os agentes da organização).
 */
const AGENT_ID = '00000000-0000-0000-0000-000000000000';

export default function AdaflowAgentPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <AdaflowAgentRunner agentId={AGENT_ID} title="Agente Adaflow" />
    </main>
  );
}
