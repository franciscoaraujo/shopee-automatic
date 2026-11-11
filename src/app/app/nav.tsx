'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/icons';

const ITEMS: { href: string; label: string; icon: IconName }[] = [
  { href: '/app', label: 'Painel', icon: 'monitoring' },
  { href: '/app/configuracoes', label: 'Configurar', icon: 'tune' },
  { href: '/app/conta', label: 'Conta', icon: 'person' },
];

const isActive = (path: string, href: string) => (href === '/app' ? path === '/app' : path.startsWith(href));

// Navigation rail (≥ lg) e navigation bar (< lg), conforme Material 3
export function AppNav({ attention }: { attention?: boolean }) {
  const path = usePathname();
  return (
    <>
      <nav aria-label="Principal" className="fixed inset-y-0 left-0 z-20 hidden w-24 flex-col items-center gap-3 border-r border-outline-variant/60 bg-surface pt-20 lg:flex">
        {ITEMS.map((it) => {
          const on = isActive(path, it.href);
          return (
            <Link key={it.href} href={it.href} aria-current={on ? 'page' : undefined} className="group flex w-full flex-col items-center gap-1 py-1 text-label-m text-on-surface-variant aria-[current=page]:text-on-surface">
              <span className={`state-layer relative grid h-8 w-14 place-items-center rounded-full transition-colors ${on ? 'bg-secondary-container text-on-secondary-container' : ''}`}>
                <Icon name={it.icon} />
                {it.href === '/app/configuracoes' && attention && <span className="absolute right-3 top-1 size-2 rounded-full bg-error" aria-label="requer atenção" />}
              </span>
              {it.label}
            </Link>
          );
        })}
      </nav>
      <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-20 grid h-20 grid-cols-3 border-t border-outline-variant/60 bg-surface-container lg:hidden">
        {ITEMS.map((it) => {
          const on = isActive(path, it.href);
          return (
            <Link key={it.href} href={it.href} aria-current={on ? 'page' : undefined} className="flex flex-col items-center justify-center gap-1 text-label-m text-on-surface-variant aria-[current=page]:text-on-surface">
              <span className={`state-layer relative grid h-8 w-16 place-items-center rounded-full ${on ? 'bg-secondary-container text-on-secondary-container' : ''}`}>
                <Icon name={it.icon} />
                {it.href === '/app/configuracoes' && attention && <span className="absolute right-4 top-1 size-2 rounded-full bg-error" />}
              </span>
              {it.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
