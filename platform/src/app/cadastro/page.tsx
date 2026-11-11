import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SignupForm } from '@/app/(auth)/forms';
import { Icon, type IconName } from '@/components/icons';
import { Footer, TopBar } from '@/components/landing/chrome';
import { listPlans } from '@/server/plans';

export const metadata: Metadata = {
  title: 'Criar conta',
  description: 'Teste grátis por 7 dias: seu grupo de ofertas Shopee publicando sozinho no WhatsApp e no Telegram.',
};

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'person', title: 'Crie sua conta', text: 'Menos de um minuto, sem cartão.' },
  { icon: 'link', title: 'Conecte a Shopee', text: 'Cole o App ID e o Secret da sua conta de afiliado.' },
  { icon: 'chat', title: 'Leia o QR Code', text: 'Conecte o WhatsApp e escolha o grupo, direto no painel.' },
  { icon: 'rocket_launch', title: 'Primeira oferta no ar', text: 'Na próxima rodada, a oferta sai com o seu link.' },
];

async function FormWithParams({ searchParams }: { searchParams: PageProps<'/cadastro'>['searchParams'] }) {
  const sp = await searchParams;
  const plans = await listPlans();
  const plano = typeof sp.plano === 'string' && plans.some((p) => p.id === sp.plano) ? sp.plano : undefined;
  const cupom = typeof sp.cupom === 'string' && /^[A-Za-z0-9_-]{3,30}$/.test(sp.cupom) ? sp.cupom.toUpperCase() : undefined;
  const source = ['utm_source', 'utm_campaign', 'ref']
    .map((k) => (typeof sp[k] === 'string' ? `${k}=${String(sp[k]).slice(0, 60)}` : null))
    .filter(Boolean)
    .join('&');
  return <SignupForm plans={plans} defaultPlan={plano} defaultCoupon={cupom} source={source || undefined} />;
}

export default function CadastroPage({ searchParams }: PageProps<'/cadastro'>) {
  return (
    <>
      <TopBar cta={false} />
      <main className="flex-1 bg-surface-low">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-14 md:py-20 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <aside className="lg:sticky lg:top-28 lg:self-start">
            <p className="mb-4 text-label-l uppercase tracking-[0.14em] text-primary">Teste grátis · 7 dias</p>
            <h1 className="text-display-m text-balance">Em 10 minutos, seu grupo publica sozinho.</h1>
            <p className="mt-6 text-body-l text-on-surface-variant">Você mesmo configura tudo pelo painel. Se travar em algum passo, o suporte ajuda pelo WhatsApp.</p>
            <ol className="mt-10">
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative flex gap-4 pb-7 last:pb-0">
                  {i < STEPS.length - 1 && <span aria-hidden className="absolute left-5 top-11 h-[calc(100%-2.75rem)] w-px bg-outline-variant" />}
                  <span className={`grid size-10 shrink-0 place-items-center rounded-full ${i === 0 ? 'bg-primary text-on-primary' : 'bg-surface-high text-on-surface-variant'}`}>
                    <Icon name={s.icon} size={20} />
                  </span>
                  <div className="pt-1.5">
                    <p className="text-title-m">{s.title}</p>
                    <p className="mt-0.5 text-body-m text-on-surface-variant">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </aside>
          <Suspense fallback={<div className="h-[720px] animate-pulse rounded-xl bg-surface-lowest shadow-e1" />}>
            <FormWithParams searchParams={searchParams} />
          </Suspense>
        </div>
      </main>
      <Footer />
    </>
  );
}
