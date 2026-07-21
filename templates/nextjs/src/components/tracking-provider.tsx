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

  // Tenta iniciar a CADA mudança de rota (não só no mount): no fluxo SSO o
  // provider monta antes do callback gravar o JWT, e a navegação seguinte é
  // client-side — sem esta re-tentativa a sessão nunca começaria.
  useEffect(() => {
    if (!handleRef.current && getJwt()) {
      try {
        handleRef.current = startSessionTracking(getTrackingClient());
      } catch {
        // Telemetria nunca quebra o app.
      }
    }
    handleRef.current?.pageView(pathname);
  }, [pathname]);

  // Encerra a sessão só no unmount real do app.
  useEffect(() => {
    return () => {
      const handle = handleRef.current;
      handleRef.current = null;
      void handle?.stop();
    };
  }, []);

  return null;
}

/** Hook de conveniência para registrar passos de negócio em componentes. */
export function useAdaflowTracking(): { track: typeof track } {
  return { track };
}
