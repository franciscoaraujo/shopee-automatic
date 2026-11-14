import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Icon } from '@/components/icons';
import { Logo } from '@/components/landing/chrome';
import { waLink } from '@/lib/site';
import { isOperational, trialDaysLeft } from '@/server/accounts';
import { requireSession } from '@/server/session';
import { TRIAL_PLAN } from '@/lib/plans';
import { getPlan } from '@/server/plans';
import { getSettings, readiness } from '@/server/settings';
import { AppNav } from './nav';

export const metadata: Metadata = { title: { default: 'Painel', template: '%s · AutoAchados' }, robots: { index: false } };

async function Shell({ children }: { children: React.ReactNode }) {
  await connection();
  const { account, user } = await requireSession();
  const settings = await getSettings(account.id);
  const ready = readiness(settings, null).ready;
  const [plan, trialPlan] = await Promise.all([getPlan(account.plan), getPlan(TRIAL_PLAN)]);
  const days = trialDaysLeft(account);
  const running = isOperational(account);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-outline-variant/60 bg-surface/95 backdrop-blur lg:pl-24">
        {/* Canto superior esquerdo (≥ lg): símbolo alinhado ao navigation rail */}
        <div className="absolute inset-y-0 left-0 hidden w-24 place-items-center border-r border-outline-variant/60 lg:grid">
          <Logo compact />
        </div>
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-5">
          <Logo className="lg:hidden" />
          <p className="hidden truncate text-title-m lg:block">{account.name}</p>
          <span className="ml-auto inline-flex h-7 items-center rounded-sm border border-outline-variant px-2.5 text-label-m text-on-surface-variant">
            {account.status === 'trial' ? `Teste grátis · recursos do ${trialPlan.name}` : `Plano ${plan.name}`}
          </span>
          <span className="hidden text-body-m text-on-surface-variant sm:inline">{user.email}</span>
        </div>
      </header>
      <AppNav attention={!ready} />
      <div className="flex-1 pb-24 lg:pb-0 lg:pl-24">
        {!running && (
          <div className="border-b border-error/20 bg-error-container text-on-error-container">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-5 py-3 text-body-m">
              <Icon name="pause_circle" size={20} />
              <span className="flex-1">
                {account.status === 'trial' ? 'Seu período de teste terminou.' : account.status === 'suspended' ? 'Sua conta está suspensa.' : 'Sua conta está cancelada.'}{' '}
                A esteira está pausada e nada é publicado.
              </span>
              <a href={waLink(`Olá! Quero ativar minha conta (${user.email}).`)} target="_blank" rel="noopener noreferrer" className="text-label-l underline underline-offset-2">
                Falar com o suporte
              </a>
            </div>
          </div>
        )}
        {running && days !== null && (
          <div className="border-b border-outline-variant/60 bg-tertiary/5">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-5 py-2.5 text-body-m text-on-surface">
              <Icon name="schedule" size={20} className="text-tertiary" />
              <span className="flex-1">
                {days === 0 ? 'Último dia do seu teste grátis.' : `Teste grátis: ${days} ${days === 1 ? 'dia restante' : 'dias restantes'}.`}
              </span>
              <Link href="/app/conta" className="text-label-l text-tertiary underline underline-offset-2">Ver planos</Link>
            </div>
          </div>
        )}
        {children}
      </div>
    </>
  );
}

export default function AppLayout({ children }: LayoutProps<'/app'>) {
  return (
    <Suspense fallback={<div className="grid flex-1 place-items-center text-body-l text-on-surface-variant">Carregando…</div>}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
