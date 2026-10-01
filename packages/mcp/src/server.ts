/**
 * Definição das tools MCP sobre o `@adaflow/sdk` — separada do entrypoint
 * stdio para ser testável com transporte em memória e fetch mockado.
 */
import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { AdaflowApiError, AdaflowClient, type AdaflowClientOptions } from '@adaflow/sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

export const SERVER_NAME = 'adaflow';
export const SERVER_VERSION = '0.1.0';

/** Fonte do client: instância pronta (testes) ou fábrica chamada sob demanda. */
export type ClientSource = AdaflowClient | (() => AdaflowClient);

export interface ServerEnv {
  ADAFLOW_JWT?: string;
  ADAFLOW_APP_TOKEN?: string;
  ADA_TOKEN?: string;
  ADAFLOW_BASE_URL?: string;
  ADAFLOW_CLIENT?: string;
}

const clean = (v: string | undefined): string | undefined => (v && v.trim().length > 0 ? v.trim() : undefined);

/**
 * Opções do client a partir do ambiente. JWT do usuário tem precedência
 * (ações auditadas no usuário real); app token é o modo server-to-server.
 */
export function clientOptionsFromEnv(env: ServerEnv): AdaflowClientOptions {
  const jwt = clean(env.ADAFLOW_JWT);
  const appToken = clean(env.ADAFLOW_APP_TOKEN) ?? clean(env.ADA_TOKEN);
  return {
    ...(jwt ? { jwt } : appToken ? { appToken } : {}),
    baseUrl: clean(env.ADAFLOW_BASE_URL),
    client: clean(env.ADAFLOW_CLIENT),
  };
}

/** Content-types aceitos pelo pipeline de ingestão, por extensão. */
const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

export function guessContentType(fileName: string): string {
  return CONTENT_TYPES[extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
}

/** Converte qualquer falha em resultado de tool com `isError`, com dica acionável. */
export function toolError(err: unknown): CallToolResult {
  let text: string;
  if (err instanceof AdaflowApiError) {
    const hint = err.isAuthError
      ? ' Credencial inválida ou expirada: revise ADAFLOW_APP_TOKEN / ADAFLOW_JWT na configuração do plugin.'
      : err.isInsufficientQuota
        ? ' A organização está sem saldo de créditos.'
        : err.status === 403
          ? ' A credencial não tem permissão para esta operação.'
          : '';
    text = `Adaflow API ${err.status}${err.code ? ` (${err.code})` : ''}: ${err.message}.${hint}`;
  } else {
    text = err instanceof Error ? err.message : String(err);
  }
  return { content: [{ type: 'text', text }], isError: true };
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;

/** Cria o servidor MCP com todas as tools do Adaflow. */
export function createAdaflowMcpServer(source: ClientSource): McpServer {
  let cached: AdaflowClient | undefined;
  // Client lazy: o servidor sobe mesmo sem credencial e a tool explica o que falta.
  const client = (): AdaflowClient => {
    if (cached) return cached;
    cached = typeof source === 'function' ? source() : source;
    return cached;
  };
  const run =
    <A>(fn: (args: A) => Promise<unknown>) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        return ok(await fn(args));
      } catch (err) {
        return toolError(err);
      }
    };

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // ── Catálogo e chat ──────────────────────────────────────────────────────
  server.registerTool(
    'list_models',
    {
      title: 'Listar modelos',
      description:
        'Lista os modelos do catálogo curado do Adaflow (ids no formato <provedor>/<modelo>) para usar em chat.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    run(async () => client().chat.models()),
  );

  server.registerTool(
    'list_specialists',
    {
      title: 'Listar especialistas',
      description:
        'Lista os especialistas (assistants) da organização. Use o UUID retornado como model "assistant:<uuid>" na tool chat.',
      inputSchema: {
        search: z.string().optional().describe('Filtro por nome'),
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(100).optional(),
      },
      annotations: READ_ONLY,
    },
    run(async (args: { search?: string; page?: number; limit?: number }) => client().specialists.list(args)),
  );

  server.registerTool(
    'get_specialist',
    {
      title: 'Detalhar especialista',
      description: 'Detalhes de um especialista e os repositórios de conhecimento vinculados a ele.',
      inputSchema: { specialistId: z.string().describe('UUID do especialista') },
      annotations: READ_ONLY,
    },
    run(async ({ specialistId }: { specialistId: string }) => {
      const [specialist, repositories] = await Promise.all([
        client().specialists.get(specialistId),
        client().specialists.repositories(specialistId),
      ]);
      return { ...specialist, linkedRepositories: repositories.repositories };
    }),
  );

  server.registerTool(
    'chat',
    {
      title: 'Conversar com modelo ou especialista',
      description:
        'Envia uma mensagem ao Adaflow pela API OpenAI-compatible. model = "assistant:<uuid>" conversa com um ' +
        'especialista (skills, conectores, tools MCP, governança; RAG das bases NÃO se aplica por API) ou um id do ' +
        'catálogo para chamada genérica. Para continuar a conversa, reenvie o chatId retornado e só a mensagem nova.',
      inputSchema: {
        model: z.string().describe('"assistant:<uuid>" ou id do catálogo (ver list_models)'),
        message: z.string().min(1).describe('Mensagem do usuário'),
        system: z.string().optional().describe('Instrução de sistema (útil no modo genérico)'),
        chatId: z.string().optional().describe('chatId retornado no turno anterior'),
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().int().positive().optional(),
      },
      annotations: WRITE,
    },
    run(
      async (args: {
        model: string;
        message: string;
        system?: string;
        chatId?: string;
        temperature?: number;
        maxTokens?: number;
      }) => {
        const messages = [
          ...(args.system ? [{ role: 'system' as const, content: args.system }] : []),
          { role: 'user' as const, content: args.message },
        ];
        const result = await client().chat.create({
          model: args.model,
          messages,
          chatId: args.chatId,
          temperature: args.temperature,
          maxTokens: args.maxTokens,
        });
        return { content: result.content, chatId: result.chatId, usage: result.completion.usage };
      },
    ),
  );

  // ── Agentes autônomos ────────────────────────────────────────────────────
  server.registerTool(
    'list_agents',
    {
      title: 'Listar agentes autônomos',
      description: 'Lista os agentes autônomos da organização.',
      inputSchema: {
        search: z.string().optional(),
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(100).optional(),
      },
      annotations: READ_ONLY,
    },
    run(async (args: { search?: string; page?: number; limit?: number }) => client().agents.list(args)),
  );

  server.registerTool(
    'execute_agent',
    {
      title: 'Executar agente autônomo',
      description:
        'Executa um agente autônomo de forma síncrona e retorna a saída. Reenvie o threadId para manter contexto. ' +
        'Exige a permissão autonomous-agents.execute.',
      inputSchema: {
        agentId: z.string(),
        input: z.string().min(1).max(50_000).describe('Comando/mensagem para o agente'),
        threadId: z.string().optional(),
      },
      annotations: WRITE,
    },
    run(async ({ agentId, input, threadId }: { agentId: string; input: string; threadId?: string }) =>
      client().agents.execute(agentId, { input, threadId }),
    ),
  );

  // ── Repositórios de conhecimento ─────────────────────────────────────────
  server.registerTool(
    'create_repository',
    {
      title: 'Criar repositório de conhecimento',
      description:
        'Cria um repositório de conhecimento (RAG no chat do Adaflow). Exige JWT de usuário ADMIN/CREATOR e a ' +
        'feature flag knowledge.creation na organização.',
      inputSchema: {
        name: z.string().min(1),
        description: z.string().optional(),
        slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
        visibility: z.enum(['PRIVATE', 'TEAM', 'ORG', 'PUBLIC']).optional().describe('Default PRIVATE'),
        teamIds: z.array(z.string()).optional().describe('Obrigatório quando visibility = TEAM'),
      },
      annotations: WRITE,
    },
    run(
      async (args: {
        name: string;
        description?: string;
        slug?: string;
        visibility?: 'PRIVATE' | 'TEAM' | 'ORG' | 'PUBLIC';
        teamIds?: string[];
      }) => client().repositories.create(args),
    ),
  );

  server.registerTool(
    'list_repository_files',
    {
      title: 'Listar arquivos do repositório',
      description: 'Lista os arquivos de um repositório e o status de processamento (OCR/embedding).',
      inputSchema: { repositoryId: z.string() },
      annotations: READ_ONLY,
    },
    run(async ({ repositoryId }: { repositoryId: string }) => {
      const [repository, files] = await Promise.all([
        client().repositories.get(repositoryId),
        client().repositories.listFiles(repositoryId),
      ]);
      return { repository, files };
    }),
  );

  server.registerTool(
    'upload_document',
    {
      title: 'Enviar documento ao repositório',
      description:
        'Envia um arquivo local ao repositório (presign → upload → confirm). O processamento continua assíncrono; ' +
        'acompanhe com list_repository_files.',
      inputSchema: {
        repositoryId: z.string(),
        filePath: z.string().describe('Caminho do arquivo local (absoluto ou relativo ao diretório atual)'),
        fileName: z.string().optional().describe('Nome no repositório (default: nome do arquivo)'),
        contentType: z.string().optional().describe('Default: inferido pela extensão'),
      },
      annotations: WRITE,
    },
    run(
      async (args: { repositoryId: string; filePath: string; fileName?: string; contentType?: string }) => {
        const path = resolve(args.filePath);
        const data = new Uint8Array(await readFile(path));
        const fileName = args.fileName ?? basename(path);
        const contentType = args.contentType ?? guessContentType(fileName);
        const { fileId } = await client().repositories.uploadDocument(args.repositoryId, {
          fileName,
          contentType,
          data,
        });
        return { fileId, fileName, contentType, bytes: data.byteLength, status: 'confirmed; processando' };
      },
    ),
  );

  // ── Governança ───────────────────────────────────────────────────────────
  server.registerTool(
    'list_audit_logs',
    {
      title: 'Consultar trilha de auditoria',
      description:
        'Consulta logs de auditoria do módulo Governança. Use sourceService "app:<slug>" para filtrar por app ' +
        'parceiro. Pagine reenviando nextCursor como cursor. Exige permissão platform.audit.read (perfil admin).',
      inputSchema: {
        search: z.string().optional(),
        category: z.string().optional(),
        severity: z.enum(['info', 'warning', 'critical']).optional(),
        action: z.string().optional(),
        resource: z.string().optional(),
        actorUserId: z.string().optional(),
        sourceService: z.string().optional(),
        startDate: z.string().optional().describe('ISO 8601'),
        endDate: z.string().optional().describe('ISO 8601'),
        success: z.boolean().optional(),
        cursor: z.string().optional(),
        pageSize: z.number().int().positive().max(200).optional(),
      },
      annotations: READ_ONLY,
    },
    run(async (args: Record<string, unknown>) =>
      client().governance.listLogs(args as Parameters<AdaflowClient['governance']['listLogs']>[0]),
    ),
  );

  server.registerTool(
    'governance_overview',
    {
      title: 'Visão geral de governança',
      description:
        'Dashboard executivo: estatísticas de auditoria, top usuários/ações/módulos, heatmap e alertas. ' +
        'Exige permissão platform.audit.read (perfil admin).',
      inputSchema: {
        period: z.enum(['24h', '7d', '30d']).optional().describe('Default do servidor quando omitido'),
        timeZone: z.string().optional().describe('IANA, ex.: America/Sao_Paulo'),
      },
      annotations: READ_ONLY,
    },
    run(async ({ period, timeZone }: { period?: '24h' | '7d' | '30d'; timeZone?: string }) => {
      const [stats, overview] = await Promise.all([
        client().governance.stats({ period }),
        client().governance.governanceOverview({ period, timeZone }),
      ]);
      return { stats, overview };
    }),
  );

  // ── Billing ──────────────────────────────────────────────────────────────
  server.registerTool(
    'billing',
    {
      title: 'Saldo e consumo',
      description: 'Saldo da wallet da organização e os eventos de consumo mais recentes.',
      inputSchema: {
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(100).optional(),
      },
      annotations: READ_ONLY,
    },
    run(async (args: { page?: number; limit?: number }) => {
      const [wallet, usage] = await Promise.all([client().billing.wallet(), client().billing.usage(args)]);
      return { wallet, usage };
    }),
  );

  return server;
}
