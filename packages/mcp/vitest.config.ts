import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve o SDK pelo código-fonte do workspace: testes não dependem de build prévio.
export default defineConfig({
  resolve: {
    alias: { '@adaflow/sdk': fileURLToPath(new URL('../sdk/src/index.ts', import.meta.url)) },
  },
});
