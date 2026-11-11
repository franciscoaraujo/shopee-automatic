import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Icon, type IconName } from '@/components/icons';
import Link from 'next/link';
import { effectiveInterval, formatInterval } from '@/lib/plans';
import { effectivePlan, listPlans } from '@/server/plans';
import { describePolicy, describeSchedule, describeWhen, effectiveSchedule, isWithin, nextOpening } from '@/lib/schedule';
import { waState } from '@/server/integrations';
import { requireSession } from '@/server/session';
import { getPublicSettings, getSettings, readiness } from '@/server/settings';
import { ScheduleForm, ShopeeForm, TelegramForm, WhatsAppPanel } from './forms';
import { SearchPanel } from './search-form';
import { FrequencyForm } from './frequency-form';

export const metadata: Metadata = { title: 'Configurar' };

function Card({ id, icon, title, description, status, children }: {
  id: string; icon: IconName; title: string; description: React.ReactNode; status?: { ok: boolean; label: string } | null; children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-xl border border-outline-variant/70 bg-surface-lowest p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <span className="grid size-11 place-items-center rounded-md bg-primary/10 text-primary"><Icon name={icon} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-title-l">{title}</h2>
          <p className="mt-1 text-body-m text-on-surface-variant">{description}</p>
        </div>
        {status && (
          <span className={`inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-label-m ${status.ok ? 'bg-success-container text-on-success-container' : 'bg-surface-high text-on-surface-variant'}`}>
            <Icon name={status.ok ? 'check' : 'remove'} size={16} /> {status.label}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<'/app/configuracoes'>['searchParams'] }) {
  await connection();
  const sp = await searchParams;
  const { account, user } = await requireSession();
  const [pub, raw, wa] = await Promise.all([getPublicSettings(account.id), getSettings(account.id), waState(account.id)]);
  const r = readiness(raw, wa.state === 'open');
  const [plan, plans] = await Promise.all([effectivePlan(account), listPlans()]);
  // Planos à venda que liberam ciclos menores que o atual (para mostrar o que existe acima)
  const better = plans.filter((p) => p.intervalMin < plan.intervalMin).map((p) => ({ name: p.name, intervalMin: p.intervalMin }));
  const welcome = sp['bem-vindo'] === '1';
  const sched = effectiveSchedule(plan, raw);
  const policy = plan.schedule;
  const open = isWithin(sched);
  const opening = open ? null : nextOpening(sched);

  return (
    <main className="mx-auto max-w-4xl px-5 py-8 md:py-12">
      <h1 className="text-display-s">{welcome ? `Bem-vindo, ${user.name.split(' ')[0]}!` : 'Configurar'}</h1>
      <p className="mt-2 text-body-l text-on-surface-variant">
        {welcome ? 'Três passos e sua esteira começa a publicar sozinha.' : 'Contas conectadas e regras de publicação. Alterações valem a partir da próxima rodada.'}
      </p>

      {/* Checklist */}
      <ol className="mt-8 grid gap-3 sm:grid-cols-3">
        {r.items.map((i, idx) => (
          <li key={i.id}>
            <a href={`#${i.id}`} className={`state-layer flex h-full items-start gap-3 rounded-lg border p-4 ${i.ok || i.enabled === false ? 'border-outline-variant/70 bg-surface-lowest' : 'border-primary/40 bg-primary/5'}`}>
              <span className={`grid size-7 shrink-0 place-items-center rounded-full text-label-m ${i.enabled === false ? 'bg-surface-high text-on-surface-variant' : i.ok ? 'bg-success-container text-on-success-container' : 'bg-primary text-on-primary'}`}>
                {i.ok && i.enabled !== false ? <Icon name="check" size={16} /> : idx + 1}
              </span>
              <span>
                <span className="block text-title-s">{i.label}</span>
                <span className="block text-body-s text-on-surface-variant">{i.detail}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
      {r.ready && (
        <p className="mt-4 flex items-center gap-2 text-body-m text-success">
          <Icon name="check_circle_fill" size={18} /> Tudo pronto. A esteira roda a cada {formatInterval(effectiveInterval(plan, raw.runIntervalMin))}.
        </p>
      )}

      <div className="mt-10 space-y-6">
        <Card id="shopee" icon="shopping_bag" title="Shopee Afiliados"
          description={<>Em <a className="text-primary underline" href="https://affiliate.shopee.com.br" target="_blank" rel="noopener noreferrer">affiliate.shopee.com.br</a> → Open API, copie o App ID e o Secret.</>}
          status={{ ok: r.items[0].ok, label: r.items[0].ok ? 'Salva' : 'Pendente' }}>
          <ShopeeForm settings={pub} />
        </Card>

        <Card id="whatsapp" icon="chat" title="WhatsApp" description="Conecte um número lendo o QR Code e escolha o grupo de destino."
          status={!raw.whatsappEnabled && wa.state !== 'open' ? { ok: false, label: 'Desativado' } : { ok: wa.state === 'open' && !!raw.whatsappGroupJid, label: wa.state === 'open' ? (raw.whatsappGroupJid ? 'Publicando' : 'Escolha o grupo') : 'Desconectado' }}>
          <WhatsAppPanel initialState={wa.state} initialError={wa.error} settings={pub} />
        </Card>

        <Card id="telegram" icon="send" title="Telegram"
          description={<>Crie um bot no <b>@BotFather</b> (selo azul), adicione-o como administrador do canal e informe o @ do canal.{plan.maxChannels < 2 && <> Seu plano permite um canal por vez.</>}</>}
          status={raw.telegramEnabled ? { ok: r.items[2].ok, label: r.items[2].ok ? 'Ativo' : 'Pendente' } : { ok: false, label: 'Desativado' }}>
          <TelegramForm settings={pub} />
        </Card>

        <Card id="frequencia" icon="sync" title="Frequência"
          description={<>De quanto em quanto tempo a esteira publica. Seu plano permite a partir de <b className="text-on-surface">{formatInterval(plan.intervalMin)}</b>.</>}
          status={{ ok: true, label: `A cada ${formatInterval(effectiveInterval(plan, raw.runIntervalMin))}` }}>
          <FrequencyForm current={effectiveInterval(plan, raw.runIntervalMin)} minimum={plan.intervalMin} better={better} />
        </Card>

        <Card id="horario" icon="schedule" title="Horário de envio"
          description={<>Quando a esteira pode publicar (horário de Brasília). Fora dele nada é enviado e a próxima rodada começa na abertura. <b className="text-on-surface">{describeSchedule(sched)}.</b></>}
          status={!sched.enabled ? { ok: true, label: 'Sempre ativo' } : open ? { ok: true, label: 'Enviando agora' } : { ok: false, label: opening ? `Volta ${describeWhen(opening)}` : 'Pausado' }}>
          <p className="mb-5 flex items-center gap-2 rounded-md bg-surface-container px-4 py-3 text-body-m text-on-surface-variant">
            <Icon name="info" size={18} className="text-primary" />
            <span>Plano {plan.name}{account.status === 'trial' ? ' (teste grátis)' : ''}: {describePolicy(plan)}.{plan.custom.length > 0 && <> Sua conta tem limites sob medida ({plan.custom.join(', ')}).</>}</span>
          </p>
          {policy.mode === 'fixed' ? (
            <div className="flex flex-wrap items-center gap-4">
              <p className="flex-1 text-body-l">
                Neste plano a esteira publica das <b>{policy.start}</b> às <b>{policy.end}</b>, todos os dias, e retoma no dia seguinte.
              </p>
              <Link href="/app/conta" className="state-layer inline-flex h-10 items-center gap-2 rounded-full border border-outline px-5 text-label-l text-primary">
                Escolher meu horário no Pro <Icon name="arrow_forward" size={18} />
              </Link>
            </div>
          ) : (
            <ScheduleForm settings={pub} mode={policy.mode} earliest={policy.mode === 'bounded' ? policy.earliest : undefined} latest={policy.mode === 'bounded' ? policy.latest : undefined} />
          )}
        </Card>

        <Card id="busca" icon="tune" title="Busca e publicação" description="Como as ofertas são escolhidas a cada rodada. Vale a partir da próxima rodada.">
          <SearchPanel settings={pub} maxPerRun={plan.maxPerRun} />
        </Card>
      </div>
    </main>
  );
}

export default function ConfigPage({ searchParams }: PageProps<'/app/configuracoes'>) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-4xl px-5 py-12 text-body-l text-on-surface-variant">Carregando…</div>}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
