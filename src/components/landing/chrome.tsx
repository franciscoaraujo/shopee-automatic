// Barra superior e rodapé
import Link from 'next/link';
import { site } from '@/lib/site';
import { Icon } from '../icons';
import { LinkButton } from '../md';

const NAV = [
  { href: '/#rodada', label: 'Como funciona' },
  { href: '/#controle', label: 'Controle' },
  { href: '/#planos', label: 'Planos' },
  { href: '/#duvidas', label: 'Dúvidas' },
];

// compact: só o símbolo (ex.: topo do navigation rail do painel)
export function Logo({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  return (
    <Link href="/" className={`flex items-center gap-2.5 font-display text-[1.2rem] font-bold tracking-tight ${className}`} aria-label={`${site.name}, início`}>
      <span className={`grid place-items-center bg-primary text-on-primary ${compact ? 'size-10 rounded-xl' : 'size-8 rounded-[10px]'}`}>
        <Icon name="bolt" size={compact ? 24 : 20} />
      </span>
      {!compact && site.name}
    </Link>
  );
}

export function TopBar({ cta = true }: { cta?: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-outline-variant/60 bg-surface/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:gap-8 sm:px-5">
        <Logo />
        <nav aria-label="Seções" className="ml-auto hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="state-layer rounded-full px-4 py-2 text-label-l text-on-surface-variant hover:text-on-surface">
              {n.label}
            </Link>
          ))}
        </nav>
        <Link href="/entrar" className={`state-layer rounded-full px-3 py-2 text-label-l text-primary ${cta ? 'ml-auto max-sm:hidden md:ml-0' : 'ml-auto'}`}>
          Entrar
        </Link>
        {cta && (
          <LinkButton href="/cadastro" className="max-sm:ml-auto max-sm:h-9 max-sm:px-4">
            Teste grátis
          </LinkButton>
        )}
        {/* menu móvel sem JavaScript */}
        <details className="relative md:hidden">
          <summary className="state-layer grid size-10 cursor-pointer list-none place-items-center rounded-full text-on-surface-variant [&::-webkit-details-marker]:hidden" aria-label="Abrir menu">
            <Icon name="menu" />
          </summary>
          <nav className="absolute right-0 top-12 w-56 rounded-md bg-surface-container py-2 shadow-e2">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="state-layer block px-4 py-3 text-body-l">
                {n.label}
              </Link>
            ))}
            <Link href="/entrar" className="state-layer block border-t border-outline-variant px-4 py-3 text-body-l text-primary">
              Entrar
            </Link>
          </nav>
        </details>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-outline-variant bg-surface-low">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm text-body-m text-on-surface-variant">
            Automação de publicação de ofertas para afiliados. Ferramenta independente, sem vínculo com Shopee, WhatsApp ou Telegram;
            as marcas citadas pertencem aos seus donos.
          </p>
        </div>
        <div>
          <p className="text-title-s">Produto</p>
          <ul className="mt-3 space-y-2 text-body-m text-on-surface-variant">
            <li><Link className="hover:text-primary" href="/#rodada">Como funciona</Link></li>
            <li><Link className="hover:text-primary" href="/#planos">Planos</Link></li>
            <li><Link className="hover:text-primary" href="/cadastro">Criar conta</Link></li>
            <li><Link className="hover:text-primary" href="/entrar">Entrar</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-title-s">Contato</p>
          <ul className="mt-3 space-y-2 text-body-m text-on-surface-variant">
            <li><a className="hover:text-primary" href={`mailto:${site.email}`}>{site.email}</a></li>
            <li><Link className="hover:text-primary" href="/privacidade">Privacidade</Link></li>
          </ul>
        </div>
      </div>
      <p className="border-t border-outline-variant/70 py-5 text-center text-body-s text-on-surface-variant">
        © {site.name} · Todos os direitos reservados
      </p>
    </footer>
  );
}
