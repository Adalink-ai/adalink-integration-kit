/**
 * Singleton do Prisma Client (padrão Next.js — evita esgotar conexões no dev
 * com hot reload). O chat com o Adaflow não depende de banco; use este client
 * para o domínio do SEU app (ex.: persistir o ChatSession do schema).
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
