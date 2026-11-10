import { headers } from 'next/headers';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

const BLOCKS = [
  {
    name: 'adaflow-chat',
    title: 'Chat com especialista',
    description:
      'Chat com um especialista ou modelo da Adaflow, com a resposta aparecendo enquanto é gerada. Guarda o histórico na Adaflow pelo chatId.',
    demo: '/adaflow/chat',
  },
  {
    name: 'adaflow-agent-runner',
    title: 'Executar agente autônomo',
    description: 'Envia uma tarefa a um agente autônomo da Adaflow e mostra o resultado. Mantém o contexto entre execuções.',
    demo: '/adaflow/agent',
  },
] as const;

const MCP_URL = 'https://adaflow-mcp.adalink.app/mcp';

async function registryOrigin(): Promise<string> {
  const configured = process.env.REGISTRY_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export default async function CatalogPage() {
  const origin = await registryOrigin();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Adaflow para v0</h1>
        <p className="text-muted-foreground">
          Blocos prontos para conectar um app do v0 à Adaflow. Abra no v0, adicione a variável{' '}
          <code className="font-mono text-sm">ADAFLOW_APP_TOKEN</code> nas Vars do projeto e peça ao v0 o que construir.
        </p>
      </header>

      <section className="grid gap-4">
        {BLOCKS.map((block) => {
          const itemUrl = `${origin}/r/${block.name}.json`;
          const openInV0 = `https://v0.dev/chat/api/open?url=${encodeURIComponent(itemUrl)}`;
          return (
            <Card key={block.name}>
              <CardHeader>
                <CardTitle>{block.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>{block.description}</p>
                <p>
                  shadcn: <code className="font-mono">npx shadcn@latest add {itemUrl}</code>
                </p>
              </CardContent>
              <CardFooter className="gap-2">
                <a href={openInV0} target="_blank" rel="noreferrer" className={buttonVariants()}>
                  Abrir no v0
                </a>
                <a href={block.demo} className={buttonVariants({ variant: 'outline' })}>
                  Ver exemplo
                </a>
              </CardFooter>
            </Card>
          );
        })}
      </section>

      <section className="space-y-3 text-sm">
        <h2 className="text-lg font-semibold">Depois de abrir no v0</h2>
        <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
          <li>
            Crie um token de app na Adaflow com um usuário de serviço de permissões mínimas. O token age em nome de quem o
            criou.
          </li>
          <li>
            Nas Vars do projeto no v0, adicione <code className="font-mono">ADAFLOW_APP_TOKEN</code> com esse token, sem o
            prefixo <code className="font-mono">NEXT_PUBLIC_</code>. Até lá, o bloco mostra um aviso de configuração.
          </li>
          <li>
            Opcional: conecte o MCP da Adaflow em MCP Connections (
            <code className="font-mono">{MCP_URL}</code>, Bearer token com o mesmo token) para o v0 conhecer seus
            especialistas e agentes enquanto gera o app.
          </li>
        </ol>
        <p className="text-muted-foreground">
          O login com o usuário da Adaflow (SSO) não funciona no preview do v0 nem em domínios vercel.app. Nesses
          ambientes, o app usa o token de app.
        </p>
      </section>
    </main>
  );
}
