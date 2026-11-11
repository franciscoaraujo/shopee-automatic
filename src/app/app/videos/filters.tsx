'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

export type FilterDef = { name: string; label: string; options: { value: string; label: string }[]; allLabel: string };

// Filtros em <select>: cada mudança atualiza a URL (?nome=valor) e o servidor refaz a consulta.
export function FilterBar({ filters }: { filters: FilterDef[] }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  const set = (name: string, value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(name, value); else next.delete(name);
    next.delete('pagina');
    start(() => router.push(`${path}${next.size ? `?${next}` : ''}`, { scroll: false }));
  };

  return (
    // Largura fixa nos filtros: um <select> cresce até a opção mais longa (nomes de produto)
    <div className={`flex min-w-0 flex-wrap gap-3 transition-opacity ${pending ? 'opacity-60' : ''}`} role="group" aria-label="Filtros">
      {filters.map((f) => (
        <label key={f.name} className="flex w-full min-w-0 flex-col gap-1 text-label-m text-on-surface-variant sm:w-48">
          {f.label}
          <select
            value={sp.get(f.name) ?? ''}
            onChange={(e) => set(f.name, e.target.value)}
            className="h-10 w-full min-w-0 truncate rounded-xs border border-outline bg-surface-lowest px-3 text-body-m text-on-surface outline-none focus:border-2 focus:border-primary"
          >
            <option value="">{f.allLabel}</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}
