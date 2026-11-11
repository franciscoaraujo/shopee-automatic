import { Footer, TopBar, WhatsAppFab } from '@/components/landing/chrome';
import { LiveFeed } from '@/components/landing/live-feed';
import {
  CompareSection,
  ControlSection,
  DashboardSection,
  FaqSection,
  FinalCta,
  PlansSection,
  RunSection,
} from '@/components/landing/sections';
import { Suspense } from 'react';
import { Icon } from '@/components/icons';
import { LinkButton } from '@/components/md';

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-outline-variant/60">
      {/* textura de pontos discreta */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:radial-gradient(var(--md-outline-variant)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-16 px-5 pb-20 pt-14 md:pt-20 lg:grid-cols-[1.25fr_0.75fr] lg:gap-10 lg:pb-28">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface-lowest py-1.5 pl-2 pr-4 text-label-l text-on-surface-variant">
            <span className="rounded-full bg-primary px-2 py-0.5 text-label-m text-on-primary">Afiliados Shopee</span>
            WhatsApp e Telegram
          </p>
          <h1 className="mt-7 text-display-l text-balance">
            Seu grupo de ofertas publica sozinho.{' '}
            <span className="text-primary">A comissão continua sua.</span>
          </h1>
          <p className="mt-7 max-w-xl text-body-l text-on-surface-variant">
            Várias vezes por hora, o {`AutoAchados`} escolhe ofertas com boa comissão na Shopee, gera o seu link de afiliado e publica
            com foto, preço e texto no seu grupo. Roda na nuvem: sem instalar nada, sem deixar o computador ligado.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <LinkButton href="/cadastro" size="lg" trailingIcon="arrow_forward">
              Testar 7 dias grátis
            </LinkButton>
            <LinkButton href="#rodada" variant="text" size="lg">
              Ver uma rodada por dentro
            </LinkButton>
          </div>

          <dl className="mt-14 grid max-w-xl grid-cols-3 gap-6 border-t border-outline-variant pt-8">
            {[
              ['schedule', 'até 144', 'rodadas por dia'],
              ['link', '100%', 'links com seu ID'],
              ['history', '7 dias', 'sem repetir produto'],
            ].map(([icon, v, k]) => (
              <div key={k}>
                <dt className="flex items-center gap-1.5 text-body-s text-on-surface-variant">
                  <Icon name={icon as 'schedule'} size={16} />
                  {k}
                </dt>
                <dd className="mt-1 font-display text-[1.75rem] font-semibold tracking-tight">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <LiveFeed />
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <>
      <TopBar />
      <main className="flex-1">
        <Hero />
        <RunSection />
        <CompareSection />
        <ControlSection />
        <DashboardSection />
        <Suspense fallback={<div id="planos" className="mx-auto my-24 h-[640px] max-w-6xl animate-pulse rounded-xl bg-surface-low" />}>
          <PlansSection />
        </Suspense>
        <FaqSection />
        <FinalCta />
      </main>
      <Footer />
      <WhatsAppFab />
    </>
  );
}
