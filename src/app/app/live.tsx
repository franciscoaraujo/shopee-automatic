'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';

const REFRESH_MS = 15_000;
const hhmmss = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Sao_Paulo' });

// Atualiza os dados do painel (KPIs, gráfico e histórico) sem recarregar a página.
// router.refresh() re-renderiza os Server Components e preserva o estado do cliente
// (rolagem, "Ver tabela" do gráfico). Só consulta o servidor com a aba visível.
// `renderedAt` vem do servidor a cada renderização: é o horário real dos dados exibidos.
export function LiveRefresh({ renderedAt }: { renderedAt: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') start(() => router.refresh());
    };
    const id = setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router]);

  return (
    <p className="inline-flex items-center gap-2 text-body-s tabular-nums text-on-surface-variant">
      <span className="relative flex size-2" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-success" />
      </span>
      {pending ? 'Atualizando…' : `Ao vivo · atualizado às ${hhmmss.format(new Date(renderedAt))}`}
    </p>
  );
}
