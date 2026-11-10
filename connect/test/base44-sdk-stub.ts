/** Stub do `@base44/sdk` para os testes no Node: só o que a função usa. */
export function createClientFromRequest(_req: Request): { auth: { me(): Promise<{ id: string } | null> } } {
  return { auth: { me: async () => null } };
}
