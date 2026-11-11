'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/icons';

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: '/app/videos', label: 'Painel', icon: 'monitoring' },
  { href: '/app/videos/gerar', label: 'Gerar vídeos', icon: 'add_circle' },
  { href: '/app/videos/galeria', label: 'Galeria de Vídeos', icon: 'video_library' },
  { href: '/app/videos/ia', label: 'Configurações de IA', icon: 'tune' },
];

export function VideoTabs() {
  const path = usePathname();
  const active = (href: string) => (href === '/app/videos' ? path === href : path.startsWith(href));
  return (
    <nav aria-label="Seções de vídeos" className="-mx-5 flex gap-1 overflow-x-auto border-b border-outline-variant/60 px-5">
      {TABS.map((t) => {
        const on = active(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={on ? 'page' : undefined}
            className={`relative inline-flex h-12 shrink-0 items-center gap-2 px-4 text-title-s ${on ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>
            <Icon name={t.icon} size={20} /> {t.label}
            {on && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t-full bg-primary" />}
          </Link>
        );
      })}
    </nav>
  );
}
