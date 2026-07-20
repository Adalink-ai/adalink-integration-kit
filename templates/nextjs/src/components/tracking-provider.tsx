'use client';

/**
 * Liga o tracking de sessão do Adaflow quando há usuário logado.
 * Montado uma vez no layout — não renderiza nada. Os passos de negócio
 * são registrados com `track()` de `@/lib/tracking` (ou o hook abaixo).
 */
import { startSessionTracking, type SessionTrackingHandle } from '@adaflow/sdk';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { getJwt } from '@/lib/auth';
import { getTrackingClient, track } from '@/lib/tracking';

export function TrackingProvider() {
  const pathname = usePathname();
  const handleRef = useRef<SessionTrackingHandle | null>(null);

  useEffect(() => {
    if (!getJwt() || handleRef.current) return;
    try {
      handleRef.current = startSessionTracking(getTrackingClient());
    } catch {
      // Telemetria nunca quebra o app.
    }
    const handle = handleRef.current;
    return () => {
      handleRef.current = null;
      void handle?.stop();
    };
  }, []);

  // Page-view a cada mudança de rota do App Router.
  useEffect(() => {
    handleRef.current?.pageView(pathname);
  }, [pathname]);

  return null;
}

/** Hook de conveniência para registrar passos de negócio em componentes. */
export function useAdaflowTracking(): { track: typeof track } {
  return { track };
}
