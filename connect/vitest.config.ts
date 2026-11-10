import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// A função da Base44 importa o SDK pelo especificador do Deno (`npm:...`).
// No Node, os testes trocam esse import por um stub.
export default defineConfig({
  // connect/mcp e connect/v0 são pacotes próprios, com testes e config próprios.
  test: { include: ['test/**/*.test.ts'] },
  resolve: {
    alias: {
      'npm:@base44/sdk@0.8.59': fileURLToPath(new URL('./test/base44-sdk-stub.ts', import.meta.url)),
    },
  },
});
