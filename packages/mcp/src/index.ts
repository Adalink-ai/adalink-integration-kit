#!/usr/bin/env node
/**
 * adaflow-mcp — servidor MCP (stdio) da plataforma Adaflow.
 *
 * Credenciais pelo ambiente:
 *   ADAFLOW_JWT        JWT do usuário logado (preferido — ações auditadas no usuário)
 *   ADAFLOW_APP_TOKEN  app token server-to-server (alias: ADA_TOKEN)
 *   ADAFLOW_BASE_URL   API Gateway customizado (private label); default de produção
 *   ADAFLOW_CLIENT     identificador do produto chamador (header x-ada-client)
 */
import { AdaflowClient } from '@adaflow/sdk';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { clientOptionsFromEnv, createAdaflowMcpServer } from './server.js';

const server = createAdaflowMcpServer(() => new AdaflowClient(clientOptionsFromEnv(process.env)));
await server.connect(new StdioServerTransport());
// stdout é o canal do protocolo — logs só em stderr.
console.error('adaflow-mcp: pronto (stdio)');
